import type { Plugin } from "@elizaos/core";
import {
  type Action,
  type ActionResult,
  type Content,
  type GenerateTextParams,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type Provider,
  type ProviderResult,
  Service,
  type State,
  logger,
} from "@elizaos/core";
import { z } from "zod";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  toHex,
  verifyTypedData,
  getContract,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

/**
 * Define the configuration schema for the plugin with the following properties:
 *
 * @param {string} EXAMPLE_PLUGIN_VARIABLE - The name of the plugin (min length of 1, optional)
 * @returns {object} - The configured schema object
 */
const configSchema = z.object({
  EXAMPLE_PLUGIN_VARIABLE: z
    .string()
    .min(1, "Example plugin variable is not provided")
    .optional()
    .transform((val) => {
      if (!val) {
        console.warn("Warning: Example plugin variable is not provided");
      }
      return val;
    }),
  PRIVATE_KEY: z
    .string()
    .min(1, "PRIVATE_KEY is required for payment processing")
    .optional(),
  WEATHER_API_URL: z
    .string()
    .url("WEATHER_API_URL must be a valid URL")
    .optional()
    .default("https://api-qvuk23ycha-uc.a.run.app"),
});

// Payment configuration constants
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const PAYEE_ADDRESS = "0x903918bB1903714E0518Ea2122aCeBfa27f11b6F" as Address;

// EIP-3009 domain for USDC on Base Sepolia
const EIP3009_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: baseSepolia.id,
  verifyingContract: USDC_ADDRESS,
};

const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

// Create a random nonce
function createNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for Node.js
    const cryptoModule = require("crypto");
    cryptoModule.randomFillSync(randomBytes);
  }
  return toHex(randomBytes);
}

interface PaymentResult {
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
}

interface WalletInfo {
  address: string;
  nativeBalance: string;
  usdcBalance: string;
  network: string;
  chainId: number;
  blockExplorer?: string;
}

// ERC20 ABI for balance checks
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/**
 * Get wallet information including address, balances, and network details
 */
async function getWalletInfo(privateKey: string): Promise<WalletInfo | null> {
  try {
    // Create account from private key
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    
    // Create public client for reading on-chain data
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    // Get native token balance (ETH on Base Sepolia)
    const nativeBalance = await publicClient.getBalance({
      address: account.address,
    });

    // Get USDC balance
    const usdcContract = getContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      client: publicClient,
    });

    const usdcBalanceRaw = await usdcContract.read.balanceOf([
      account.address,
    ]);

    // Format balances
    const nativeBalanceFormatted = formatUnits(nativeBalance, 18); // ETH has 18 decimals
    const usdcBalanceFormatted = formatUnits(usdcBalanceRaw, 6); // USDC has 6 decimals

    return {
      address: account.address,
      nativeBalance: nativeBalanceFormatted,
      usdcBalance: usdcBalanceFormatted,
      network: baseSepolia.name,
      chainId: baseSepolia.id,
      blockExplorer: baseSepolia.blockExplorers?.default?.url,
    };
  } catch (error) {
    logger.error({ error }, "Error getting wallet info");
    return null;
  }
}

/**
 * Fetch weather report from API without payment header
 */
async function fetchWeatherWithoutPayment(
  apiUrl: string
): Promise<PaymentResult> {
  try {
    logger.info({ apiUrl: `${apiUrl}/weather` }, "Making API request to weather endpoint without payment");

    // Make the request to the weather API without payment header
    const response = await fetch(`${apiUrl}/weather`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info({ status: response.status, statusText: response.statusText }, "API response (no payment)");

    const data = await response.json();

    return {
      success: true,
      data,
      status: response.status,
    };
  } catch (error) {
    logger.error({ error }, "Error fetching weather without payment");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Process payment and fetch weather report from API
 */
async function processPaymentAndFetchWeather(
  privateKey: string,
  apiUrl: string
): Promise<PaymentResult> {
  try {
    // Create account from private key
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    logger.info({ address: account.address }, "Processing payment with wallet");

    // Create wallet client
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    // Payment details
    const amount = parseUnits("0.001", 6); // 0.001 USDC (6 decimals)
    const nonce = createNonce();
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

    logger.info({
      amount: amount.toString(),
      nonce,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
    }, "Payment details");

    // Create the authorization message
    const message = {
      from: account.address,
      to: PAYEE_ADDRESS,
      value: amount,
      validAfter,
      validBefore,
      nonce,
    };

    // Sign the typed data
    logger.info("Signing EIP-3009 authorization...");
    const signature = await walletClient.signTypedData({
      domain: EIP3009_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
      primaryType: "TransferWithAuthorization",
      message,
    });

    logger.info({ signature: signature.slice(0, 20) + "..." }, "Signature created");

    // Verify the signature locally
    const isValidSignature = await verifyTypedData({
      address: account.address,
      domain: EIP3009_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
      primaryType: "TransferWithAuthorization",
      message,
      signature,
    });

    if (!isValidSignature) {
      logger.error("Signature verification failed");
      return {
        success: false,
        error: "Signature verification failed",
      };
    }

    logger.info("Signature verified successfully");

    // Create the payment payload
    const paymentPayload = {
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: {
        signature,
        authorization: {
          from: account.address,
          to: PAYEE_ADDRESS,
          value: amount.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };

    // Base64 encode the payment
    const paymentJson = JSON.stringify(paymentPayload);
    const paymentHeader = Buffer.from(paymentJson).toString("base64");

    logger.info({ apiUrl: `${apiUrl}/weather` }, "Making API request to weather endpoint");

    // Make the request to the weather API
    const response = await fetch(`${apiUrl}/weather`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": paymentHeader,
      },
    });

    logger.info({ status: response.status, statusText: response.statusText }, "API response");

    const data = await response.json();

    if (response.status === 200) {
      logger.info("Payment successful, weather data received");
      return {
        success: true,
        data,
        status: response.status,
      };
    } else {
      logger.error({
        status: response.status,
        error: data.error,
        invalidReason: data.invalidReason,
      }, "Payment failed");
      return {
        success: false,
        data,
        status: response.status,
        error: data.error || data.invalidReason || `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    logger.error({ error }, "Error processing payment");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

const weatherReportAction: Action = {
  name: "WEATHER_REPORT",
  similes: ["WEATHER", "WEATHER_STATUS", "WEATHER_UPDATE", "GET_WEATHER"],
  description:
    "Provides weather reports. Requires payment approval of 0.001 USDC to access weather data.",

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<boolean> => {
    const messageText = message.content?.text?.toLowerCase() || "";

    // Check if message is about weather
    const weatherKeywords = [
      "weather",
      "temperature",
      "forecast",
      "climate",
      "weather report",
      "weather forecast",
    ];
    const isWeatherRequest = weatherKeywords.some((keyword) =>
      messageText.includes(keyword)
    );

    // Also check if user is approving payment (saying yes after payment prompt)
    const approvalKeywords = [
      "yes",
      "approve",
      "ok",
      "okay",
      "proceed",
      "go ahead",
      "sure",
      "fine",
    ];
    const rejectionKeywords = [
      "no",
      "deny",
      "reject",
      "cancel",
      "stop",
      "abort",
      "decline",
      "refuse",
    ];
    const isApproval = approvalKeywords.some((keyword) => messageText.includes(keyword));
    const isRejection = rejectionKeywords.some((keyword) => messageText.includes(keyword));

    // Check recent conversation for payment prompt
    if (isApproval) {
      try {
        const recentMemories = await runtime.getMemories({
          roomId: message.roomId,
          count: 10,
          tableName: "messages",
        });

        // Check if previous message was about payment (check for WEATHER_REPORT action or payment keywords)
        const hasPaymentPrompt = recentMemories.some((mem: Memory) => {
          const memText = mem.content?.text?.toLowerCase() || "";
          const hasWeatherAction =
            mem.content?.actions?.includes("WEATHER_REPORT");
          // Check if message contains payment info or has the weather report action
          if (
            hasWeatherAction ||
            memText.includes("0.001") ||
            memText.includes("usdc") ||
            memText.includes("payment")
          ) {
            return true;
          }
          return false;
        });

        return hasPaymentPrompt;
      } catch (error) {
        logger.error({ error }, "Error checking memories for payment approval");
        // Fallback: if error, still allow if message contains approval keywords
        return false;
      }
    }
    if (isRejection) {
      try {
        const recentMemories = await runtime.getMemories({
          roomId: message.roomId,
          count: 10,
          tableName: "messages",
        });

        // Check if previous message was about payment (check for WEATHER_REPORT action or payment keywords)
        const hasPaymentPrompt = recentMemories.some((mem: Memory) => {
          const memText = mem.content?.text?.toLowerCase() || "";
          const hasWeatherAction =
            mem.content?.actions?.includes("WEATHER_REPORT");
          // Check if message contains payment info or has the weather report action
          if (
            hasWeatherAction ||
            memText.includes("0.001") ||
            memText.includes("usdc") ||
            memText.includes("payment")
          ) {
            return true;
          }
          return false;
        });

        // Always allow rejection to be processed, even if we can't find payment prompt
        // The memory check is just for context, not to block the rejection
        return true;
      } catch (error) {
        logger.error({ error }, "Error checking memories for payment rejection");
        // Fallback: if error, still allow rejection to be processed
        return true;
      }
    }

    // Return true for weather requests, approvals, or rejections
    return isWeatherRequest || isApproval || isRejection;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info("Handling WEATHER_REPORT action");

      const messageText = message.content?.text?.toLowerCase() || "";
      const approvalKeywords = [
        "yes",
        "approve",
        "ok",
        "okay",
        "proceed",
        "go ahead",
        "sure",
        "fine",
      ];
      const isApproval = approvalKeywords.some((keyword) =>
        messageText.includes(keyword)
      );

      const rejectionKeywords = [
        "no",
        "deny",
        "reject",
        "cancel",
        "stop",
        "abort",
        "decline",
        "refuse",
      ];
      const isRejection = rejectionKeywords.some((keyword) => messageText.includes(keyword));
      if (isRejection) {
        // User rejected payment, fetch weather without payment header
        logger.info("Payment rejected, fetching weather without payment");

        // Get configuration from runtime
        const apiUrl =
          (runtime.getSetting("WEATHER_API_URL") as string) ||
          "https://api-qvuk23ycha-uc.a.run.app";

        // Fetch weather without payment
        const weatherResult = await fetchWeatherWithoutPayment(apiUrl);

        if (!weatherResult.success) {
          const errorMsg = `Failed to fetch weather data: ${weatherResult.error || "Unknown error"}`;
          logger.error({ weatherResult }, errorMsg);

          const errorContent: Content = {
            text: errorMsg,
            actions: ["WEATHER_REPORT"],
            source: message.content.source,
          };

          await callback(errorContent);

          return {
            text: "Failed to fetch weather after payment rejection",
            values: {
              success: false,
              error: weatherResult.error || "WEATHER_FETCH_FAILED",
            },
            data: {
              actionName: "WEATHER_REPORT",
              messageId: message.id,
              timestamp: Date.now(),
              // Only include serializable fields from weatherResult
              weatherResult: {
                success: weatherResult.success,
                status: weatherResult.status,
                error: weatherResult.error,
              },
            },
            success: false,
            error: new Error(weatherResult.error || "Weather fetch failed"),
          };
        }

        // Format weather report from API response
        const weatherData = weatherResult.data?.report || weatherResult.data;
        let weatherText: string;

        if (weatherData && typeof weatherData === "object") {
          // Format the weather data from API
          const conditions =
            weatherData.conditions ||
            weatherData.weather ||
            "Current conditions";
          const temperature =
            weatherData.temperature !== undefined
              ? `${weatherData.temperature}°F`
              : "N/A";
          const humidity =
            weatherData.humidity !== undefined
              ? `${weatherData.humidity}%`
              : "N/A";
          const windSpeed =
            weatherData.windSpeed !== undefined
              ? `${weatherData.windSpeed} mph`
              : "N/A";

          weatherText = `X-PAYMENT header not found in the request, please attach the payment header to the request and try again.`;
        } else {
          // Fallback if API response format is unexpected
          weatherText = `X-PAYMENT header not found in the request, please attach the payment header to the request and try again.`;
        }

        const responseContent: Content = {
          text: weatherText,
          actions: ["WEATHER_REPORT"],
          source: message.content.source,
        };

        await callback(responseContent);

        return {
          text: "Provided weather report after payment rejection",
          values: {
            success: true,
            weatherReported: true,
            paymentRejected: true,
          },
          data: {
            actionName: "WEATHER_REPORT",
            messageId: message.id,
            timestamp: Date.now(),
            weatherData,
            // Only include serializable fields from weatherResult
            weatherResult: {
              success: weatherResult.success,
              status: weatherResult.status,
              error: weatherResult.error,
            },
          },
          success: true,
        };
      }

      // Check if user is approving payment
      if (isApproval) {
        // User has approved, process payment and fetch weather report
        logger.info(
          "Payment approved, processing payment and fetching weather report"
        );

        // Get configuration from runtime
        const privateKey = runtime.getSetting("PRIVATE_KEY") as string;
        const apiUrl =
          (runtime.getSetting("WEATHER_API_URL") as string) ||
          "https://api-qvuk23ycha-uc.a.run.app";

        if (!privateKey) {
          const errorMsg =
            "Payment processing failed: PRIVATE_KEY not configured. Please set PRIVATE_KEY in your environment variables.";
          logger.error(errorMsg);

          const errorContent: Content = {
            text: errorMsg,
            actions: ["WEATHER_REPORT"],
            source: message.content.source,
          };

          await callback(errorContent);

          return {
            text: "Payment processing failed - missing configuration",
            values: {
              success: false,
              error: "MISSING_PRIVATE_KEY",
            },
            data: {
              actionName: "WEATHER_REPORT",
              messageId: message.id,
              timestamp: Date.now(),
            },
            success: false,
            error: new Error("PRIVATE_KEY not configured"),
          };
        }

        // Process payment and fetch weather data
        const paymentResult = await processPaymentAndFetchWeather(
          privateKey,
          apiUrl
        );

        if (!paymentResult.success) {
          const errorMsg = `Payment processing failed: ${paymentResult.error || "Unknown error"}`;
          logger.error({ paymentResult }, errorMsg);

          const errorContent: Content = {
            text: errorMsg,
            actions: ["WEATHER_REPORT"],
            source: message.content.source,
          };

          await callback(errorContent);

          return {
            text: "Payment processing failed",
            values: {
              success: false,
              error: paymentResult.error || "PAYMENT_FAILED",
            },
            data: {
              actionName: "WEATHER_REPORT",
              messageId: message.id,
              timestamp: Date.now(),
              paymentResult,
            },
            success: false,
            error: new Error(paymentResult.error || "Payment failed"),
          };
        }

        // Format weather report from API response
        const weatherData = paymentResult.data?.report || paymentResult.data;
        let weatherText: string;

        if (weatherData && typeof weatherData === "object") {
          // Format the weather data from API
          const conditions =
            weatherData.conditions ||
            weatherData.weather ||
            "Current conditions";
          const temperature =
            weatherData.temperature !== undefined
              ? `${weatherData.temperature}°F`
              : "N/A";
          const humidity =
            weatherData.humidity !== undefined
              ? `${weatherData.humidity}%`
              : "N/A";
          const windSpeed =
            weatherData.windSpeed !== undefined
              ? `${weatherData.windSpeed} mph`
              : "N/A";

          weatherText = `🌤️ Weather Report:
Current Conditions: ${conditions}
Temperature: ${temperature}
${humidity !== "N/A" ? `Humidity: ${humidity}\n` : ""}${windSpeed !== "N/A" ? `Wind Speed: ${windSpeed}\n` : ""}✅ Payment processed successfully!`;
        } else {
          // Fallback if API response format is unexpected
          weatherText = `🌤️ Weather Report:
${JSON.stringify(weatherData, null, 2)}
✅ Payment processed successfully!`;
        }

        const responseContent: Content = {
          text: weatherText,
          actions: ["WEATHER_REPORT"],
          source: message.content.source,
        };

        await callback(responseContent);

        return {
          text: "Provided weather report after payment approval",
          values: {
            success: true,
            weatherReported: true,
            paymentApproved: true,
          },
          data: {
            actionName: "WEATHER_REPORT",
            messageId: message.id,
            timestamp: Date.now(),
            weatherData,
            paymentResult,
          },
          success: true,
        };
      } else {
        // User requested weather, prompt for payment
        logger.info("Weather requested, prompting for payment approval");

        const paymentPrompt = `To access weather reports, you need to add a payment of 0.001 USDC. Do you approve this?`;

        const responseContent: Content = {
          text: paymentPrompt,
          actions: ["WEATHER_REPORT"],
          source: message.content.source,
        };

        await callback(responseContent);

        return {
          text: "Prompted user for payment approval",
          values: {
            success: true,
            paymentPrompted: true,
          },
          data: {
            actionName: "WEATHER_REPORT",
            messageId: message.id,
            timestamp: Date.now(),
            awaitingApproval: true,
          },
          success: true,
        };
      }
    } catch (error) {
      logger.error({ error }, "Error in WEATHER_REPORT action:");

      return {
        text: "Failed to handle weather report request",
        values: {
          success: false,
          error: "WEATHER_REPORT_FAILED",
        },
        data: {
          actionName: "WEATHER_REPORT",
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Provide me weather report",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Fetching weather report...",
          actions: ["WEATHER_REPORT"],
        },
      },
      {
        name: "{{name1}}",
        content: {
          text: "Yes",
        },
      },
      {
        name: "{{name2}}",
        content: {
          actions: ["WEATHER_REPORT"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Provide me weather report",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Fetching weather report...",
          actions: ["WEATHER_REPORT"],
        },
      },
      {
        name: "{{name1}}",
        content: {
          text: "No",
        },
      },
      {
        name: "{{name2}}",
        content: {
          actions: ["WEATHER_REPORT"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "What's the weather like?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Fetching weather report...",
          actions: ["WEATHER_REPORT"],
        },
      },
    ],
  ],
};

/**
 * Wallet Info Action
 * Provides wallet address, balance details, and network information
 */
const walletInfoAction: Action = {
  name: "WALLET_INFO",
  similes: ["WALLET", "WALLET_ADDRESS", "BALANCE", "ACCOUNT_INFO", "MY_WALLET"],
  description: "Returns wallet address, balance details (native token and USDC), and network information.",

  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const messageText = message.content?.text?.toLowerCase() || "";
    
    // Check for wallet-related keywords
    const walletKeywords = [
      "wallet",
      "address",
      "balance",
      "account",
      "my wallet",
      "wallet address",
      "show me my wallet",
      "give me my wallet",
      "what is my wallet",
    ];
    
    return walletKeywords.some((keyword) => messageText.includes(keyword));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info("Handling WALLET_INFO action");

      // Get configuration from runtime
      const privateKey = runtime.getSetting("PRIVATE_KEY") as string;

      if (!privateKey) {
        const errorMsg =
          "Wallet information unavailable: PRIVATE_KEY not configured. Please set PRIVATE_KEY in your environment variables.";
        logger.error(errorMsg);

        const errorContent: Content = {
          text: errorMsg,
          actions: ["WALLET_INFO"],
          source: message.content.source,
        };

        await callback(errorContent);

        return {
          text: "Wallet info unavailable - missing configuration",
          values: {
            success: false,
            error: "MISSING_PRIVATE_KEY",
          },
          data: {
            actionName: "WALLET_INFO",
            messageId: message.id,
            timestamp: Date.now(),
          },
          success: false,
          error: new Error("PRIVATE_KEY not configured"),
        };
      }

      // Get wallet information
      const walletInfo = await getWalletInfo(privateKey);

      if (!walletInfo) {
        const errorMsg = "Failed to retrieve wallet information. Please check your network connection.";
        logger.error(errorMsg);

        const errorContent: Content = {
          text: errorMsg,
          actions: ["WALLET_INFO"],
          source: message.content.source,
        };

        await callback(errorContent);

        return {
          text: "Failed to retrieve wallet info",
          values: {
            success: false,
            error: "WALLET_INFO_FETCH_FAILED",
          },
          data: {
            actionName: "WALLET_INFO",
            messageId: message.id,
            timestamp: Date.now(),
          },
          success: false,
          error: new Error("Failed to fetch wallet info"),
        };
      }

      // Format wallet information response
      const walletText = `👛 Wallet Information:

📍 Address: ${walletInfo.address}

💰 Balances:
   • Native Token (ETH): ${parseFloat(walletInfo.nativeBalance).toFixed(6)} ETH
   • USDC: ${parseFloat(walletInfo.usdcBalance).toFixed(6)} USDC

🌐 Network:
   • Network: ${walletInfo.network}
   • Chain ID: ${walletInfo.chainId}
   • Block Explorer: ${walletInfo.blockExplorer || "N/A"}`;

      const responseContent: Content = {
        text: walletText,
        actions: ["WALLET_INFO"],
        source: message.content.source,
      };

      await callback(responseContent);

      return {
        text: "Provided wallet information",
        values: {
          success: true,
          walletInfoProvided: true,
        },
        data: {
          actionName: "WALLET_INFO",
          messageId: message.id,
          timestamp: Date.now(),
          walletInfo,
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, "Error in WALLET_INFO action:");

      return {
        text: "Failed to retrieve wallet information",
        values: {
          success: false,
          error: "WALLET_INFO_FAILED",
        },
        data: {
          actionName: "WALLET_INFO",
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Give me my wallet address",
        },
      },
      {
        name: "{{name2}}",
        content: {
          actions: ["WALLET_INFO"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "What is my wallet balance?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          actions: ["WALLET_INFO"],
        },
      },
    ],
  ],
};

/**
 * Example Hello World Provider
 * This demonstrates the simplest possible provider implementation
 */
const helloWorldProvider: Provider = {
  name: "HELLO_WORLD_PROVIDER",
  description: "A simple example provider",

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    return {
      text: "I am a provider",
      values: {},
      data: {},
    };
  },
};

export class StarterService extends Service {
  static serviceType = "starter";
  capabilityDescription =
    "This is a starter service which is attached to the agent through the starter plugin.";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info("*** Starting starter service ***");
    const service = new StarterService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info("*** Stopping starter service ***");
    // get the service from the runtime
    const service = runtime.getService(StarterService.serviceType);
    if (!service) {
      throw new Error("Starter service not found");
    }
    service.stop();
  }

  async stop() {
    logger.info("*** Stopping starter service instance ***");
  }
}

const plugin: Plugin = {
  name: "starter",
  description: "A starter plugin for Eliza",
  // Set lowest priority so real models take precedence
  priority: -1000,
  config: {
    EXAMPLE_PLUGIN_VARIABLE: process.env.EXAMPLE_PLUGIN_VARIABLE,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    WEATHER_API_URL: process.env.WEATHER_API_URL,
  },
  async init(config: Record<string, string>) {
    logger.info("*** Initializing starter plugin ***");
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Set all environment variables at once
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = value;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages =
          error.issues?.map((e) => e.message)?.join(", ") ||
          "Unknown validation error";
        throw new Error(`Invalid plugin configuration: ${errorMessages}`);
      }
      throw new Error(
        `Invalid plugin configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
  models: {
    [ModelType.TEXT_SMALL]: async (
      _runtime,
      { prompt, stopSequences = [] }: GenerateTextParams
    ) => {
      return "Never gonna give you up, never gonna let you down, never gonna run around and desert you...";
    },
    [ModelType.TEXT_LARGE]: async (
      _runtime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      return "Never gonna make you cry, never gonna say goodbye, never gonna tell a lie and hurt you...";
    },
  },
  routes: [
    {
      name: "helloworld",
      path: "/helloworld",
      type: "GET",
      handler: async (_req: any, res: any) => {
        // send a response
        res.json({
          message: "Hello World!",
        });
      },
    },
  ],
  events: {
    MESSAGE_RECEIVED: [
      async (params) => {
        logger.info("MESSAGE_RECEIVED event received");
        // print the keys
        logger.info(
          { keys: Object.keys(params) },
          "MESSAGE_RECEIVED param keys"
        );
      },
    ],
    VOICE_MESSAGE_RECEIVED: [
      async (params) => {
        logger.info("VOICE_MESSAGE_RECEIVED event received");
        // print the keys
        logger.info(
          { keys: Object.keys(params) },
          "VOICE_MESSAGE_RECEIVED param keys"
        );
      },
    ],
    WORLD_CONNECTED: [
      async (params) => {
        logger.info("WORLD_CONNECTED event received");
        // print the keys
        logger.info(
          { keys: Object.keys(params) },
          "WORLD_CONNECTED param keys"
        );
      },
    ],
    WORLD_JOINED: [
      async (params) => {
        logger.info("WORLD_JOINED event received");
        // print the keys
        logger.info({ keys: Object.keys(params) }, "WORLD_JOINED param keys");
      },
    ],
  },
  services: [StarterService],
  actions: [weatherReportAction, walletInfoAction],
  providers: [],
};

export default plugin;
