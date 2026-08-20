import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { Loader2, CheckCircle2, AlertCircle, LogOut } from 'lucide-react';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { ExactEvmSchemeV1 } from '@x402/evm/v1';
import { extractReceiptFromResponse, extractReceiptPayload } from '@x402/extensions';

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = 8453;

/**
 * Some wallets return the EIP-712 recovery byte (`v`) as 0x00/0x01 rather than
 * the 0x1b/0x1c that ecrecover expects, which makes the facilitator reject an
 * otherwise valid signature. Signatures of any other shape (notably ERC-1271 /
 * ERC-6492 blobs from smart-contract accounts) are passed through untouched.
 */
function normalizeRecoveryByte(signature: `0x${string}`): `0x${string}` {
  if (signature.length !== 132) return signature;
  const v = signature.slice(-2).toLowerCase();
  if (v === "00") return `${signature.slice(0, -2)}1b` as `0x${string}`;
  if (v === "01") return `${signature.slice(0, -2)}1c` as `0x${string}`;
  return signature;
}

export default function PaymentForm() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  const [receiver, setReceiver] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!walletClient || !publicClient) {
      setError("Cüzdan bağlantısı bekleniyor. Lütfen tekrar deneyin.");
      return;
    }
    
    if (walletClient.chain?.id !== BASE_CHAIN_ID) {
      try {
        await switchChainAsync({ chainId: BASE_CHAIN_ID });
        setError("Ağ Base olarak değiştirildi. Lütfen işlemi tekrar başlatın.");
        return;
      } catch (err: any) {
        setError("Ağ değiştirilemedi. Lütfen manuel olarak Base ağına geçin.");
        return;
      }
    }
    
    setIsPaying(true);
    setError(null);
    setTxHash(null);

    try {
      // 1. Prepare wagmi compatible signer for x402
      const clientSigner = {
        address: walletClient.account.address,
        signTypedData: async (msg: any) => {
          const raw = await walletClient.signTypedData({
            account: walletClient.account,
            domain: msg.domain,
            types: msg.types,
            primaryType: msg.primaryType,
            message: msg.message,
          });

          const signature = normalizeRecoveryByte(raw);

          // The facilitator settles the EIP-3009 authorization by recovering the
          // payer from this signature. Verifying it here first turns an opaque
          // "invalid_exact_evm_signature" 402 into an actionable message, and
          // catches the two ways a browser wallet breaks this:
          //   - a smart-contract account signs via ERC-1271/6492, producing a
          //     blob that is not a 65-byte recoverable signature;
          //   - the wallet signs with an account other than the connected one.
          // An RPC hiccup must never block a payment that would have succeeded,
          // so only a definitive `false` is treated as a failure.
          let verified: boolean | null = null;
          try {
            verified = await publicClient.verifyTypedData({
              address: walletClient.account.address,
              domain: msg.domain,
              types: msg.types,
              primaryType: msg.primaryType,
              message: msg.message,
              signature,
            });
          } catch (e) {
            console.warn("İmza yerel olarak doğrulanamadı (RPC hatası), devam ediliyor:", e);
          }

          if (verified === false) {
            if (signature.length !== 132) {
              throw new Error(
                "Bu cüzdan akıllı kontrat hesabı imzası (ERC-1271/6492) üretti. " +
                "x402 EIP-3009 ödemesi, imzadan çözümlenebilen standart bir EOA hesabı gerektirir. " +
                "Lütfen normal bir cüzdan hesabıyla bağlanın."
              );
            }
            throw new Error(
              "Cüzdanın ürettiği imza ödeme yapan adrese çözümlenmiyor. " +
              "Cüzdanınızda imzalayan hesabın bağlı hesapla (" +
              `${walletClient.account.address.slice(0, 6)}...${walletClient.account.address.slice(-4)}) ` +
              "aynı olduğundan emin olun."
            );
          }

          return signature;
        },
        readContract: async (args: any) => {
          return await publicClient.readContract(args as any);
        }
      };

      // 2. Initialize x402 client
      const client = new x402Client();

      // 3. Register the payment schemes.
      // v2 uses CAIP-2 network ids ("eip155:8453"); v1 uses plain names ("base").
      // The facilitator picks the protocol version, and x402Client throws
      // "No client registered for x402 version: N" when that version is missing,
      // so both are registered.
      client.register("eip155:*", new ExactEvmScheme(clientSigner as any));
      client.registerV1("base", new ExactEvmSchemeV1(clientSigner as any));

      // 4. Create an x402-wrapped fetch function
      const fetchWithPayment = wrapFetchWithPayment(window.fetch.bind(window), client);

      // 5. Execute payment against Cambrian API
      const apiUrl = `/api/cambrian/evm/price-current?address=${USDC_BASE}&chain=base`;
      const response = await fetchWithPayment(apiUrl, {
        method: 'GET'
      });

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch (e) {}
        
        if (errorBody.includes("invalid_exact_evm_signature")) {
          throw new Error(
            "Ödeme imzası facilitator tarafından reddedildi. Bu genellikle imzanın " +
            "ödeme yapan adrese çözümlenmemesinden kaynaklanır: akıllı kontrat " +
            "cüzdanları (ERC-1271/6492) yerine standart bir EOA hesabı kullanın ve " +
            "cüzdanınızda Base ağının seçili olduğundan emin olun."
          );
        }

        if (errorBody.includes("invalid_exact_evm_transaction_simulation_failed")) {
          throw new Error("Ödeme simülasyonu başarısız oldu. Base ağında yeterli USDC bakiyeniz (en az 0.05 USDC) olduğundan emin olun.");
        }
        
        throw new Error(`Sunucu Hatası: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      let finalTxHash = "Payment successful (Tx managed by x402)";
      try {
        const receipt = extractReceiptFromResponse(response as any);
        if (receipt) {
          const payload = extractReceiptPayload(receipt);
          if (payload && (payload as any).transaction) {
            finalTxHash = (payload as any).transaction;
          }
        }
      } catch (e) {
        console.warn("Failed to extract TX hash from receipt", e);
      }

      setTxHash(finalTxHash);

    } catch (err: any) {
      console.error("Tam hata:", err);
      console.error("Error message:", err.message);
      console.error("Error cause:", err.cause);
      setError(err.message || "Bilinmeyen bir hata oluştu.");
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="w-full relative">
      <div className="bg-[#0d0d0d] border-2 border-emerald-500/30 p-6 sm:p-8 shadow-[0_0_50px_rgba(16,185,129,0.1)] relative">
        <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-emerald-500"></div>
        <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-emerald-500"></div>

        <div className="flex items-center justify-end mb-6 gap-2 flex-wrap">
          {!isConnected ? (
            connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => connect({ connector }, { onError: (err) => setError(`Bağlantı hatası: ${err.message}`) })}
                disabled={isConnecting}
                className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 flex items-center gap-2 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 py-2 px-4 border border-emerald-500/20"
              >
                {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Connect ${connector.name}`}
              </button>
            ))
          ) : (
            <button
              onClick={() => disconnect()}
              className="text-[10px] font-mono uppercase tracking-widest text-gray-400 hover:text-gray-200 flex items-center gap-2 transition-colors bg-[#141414] hover:bg-[#222] py-2 px-4 border border-[#333]"
            >
              Disconnect <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">Recipient Address (Optional)</label>
            <input
              type="text"
              placeholder="0x..."
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="w-full bg-black border border-[#222] px-4 py-3 font-mono text-sm focus:border-emerald-500 outline-none transition-colors text-white"
            />
          </div>

          <div className="pt-4">
            <div className="flex justify-between items-end mb-4 border-b border-[#222] pb-4">
              <span className="text-[10px] font-mono uppercase text-gray-500">Asset</span>
              <span className="font-bold text-white">Base USDC</span>
            </div>
            <button
              onClick={handlePay}
              disabled={isPaying || !isConnected}
              className={`w-full ${!isConnected ? 'bg-[#222] text-gray-500' : 'bg-emerald-500 hover:bg-emerald-400 text-black'} disabled:opacity-50 font-black uppercase py-5 text-sm tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2`}
            >
              {isPaying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : !isConnected ? (
                "Connect Wallet to Pay"
              ) : (
                "Process Payment"
              )}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-3 bg-red-950/30 p-3 border border-red-500/20 text-red-400 text-[10px] font-mono uppercase">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>

      {txHash && (
        <div className="mt-6 bg-emerald-900/10 border border-emerald-500/20 p-4 shadow-[0_0_30px_rgba(16,185,129,0.05)]">
          <div className="flex justify-between text-[11px] mb-2">
            <span className="text-emerald-400 font-bold uppercase flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> TX Status: Success
            </span>
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-gray-500 hover:text-white transition-colors"
            >
              View on Basescan ↗
            </a>
          </div>
          <div className="font-mono text-[10px] text-gray-400 break-all">{txHash}</div>
        </div>
      )}
    </div>
  );
}
