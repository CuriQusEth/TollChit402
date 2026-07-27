import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient } from 'wagmi';
import { Loader2, Wallet, ArrowRight, CheckCircle2, AlertCircle, ExternalLink, LogOut } from 'lucide-react';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { BuilderCodeClientExtension } from '@x402/extensions/builder-code';
import { extractReceiptFromResponse, extractReceiptPayload } from '@x402/extensions';

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export default function PaymentForm() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [receiver, setReceiver] = useState("");
  const [builderCode, setBuilderCode] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!walletClient || !publicClient) return;
    setIsPaying(true);
    setError(null);
    setTxHash(null);

    try {
      // 1. Prepare wagmi compatible signer for x402
      const clientSigner = {
        address: walletClient.account.address,
        signTypedData: async (msg: any) => {
          return await walletClient.signTypedData({
            account: walletClient.account,
            ...msg
          });
        },
        readContract: async (args: any) => {
          return await publicClient.readContract(args as any);
        }
      };

      // 2. Initialize x402 client
      const client = new x402Client();

      // Register the EVM scheme
      client.register("eip155:*", new ExactEvmScheme(clientSigner as any));

      // 3. Register Builder Code extension if provided
      if (builderCode.trim().startsWith('bc_')) {
        client.registerExtension(new BuilderCodeClientExtension(builderCode.trim()));
      }

      // 4. Create an x402-wrapped fetch function
      const fetchWithPayment = wrapFetchWithPayment(window.fetch, client);

      // 5. Execute payment against a test API
      const apiUrl = import.meta.env.VITE_API_URL || 'https://x402.direct/api/search';
      const response = await fetchWithPayment(apiUrl, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Sunucu Hatası: ${response.statusText}`);
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
      console.warn("x402 fetch error:", err);
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

        <div className="flex items-center justify-end mb-6">
          {!isConnected ? (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              disabled={isConnecting}
              className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 flex items-center gap-2 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 py-2 px-4 border border-emerald-500/20"
            >
              {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Connect Wallet"}
            </button>
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
          
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">Builder Code (Optional)</label>
            <input
              type="text"
              placeholder="bc_..."
              value={builderCode}
              onChange={(e) => setBuilderCode(e.target.value)}
              className="w-full bg-black border border-[#222] px-4 py-3 font-mono text-sm focus:border-emerald-500 outline-none transition-colors text-white"
            />
          </div>

          <div className="pt-4">
            <div className="flex justify-between items-end mb-4 border-b border-[#222] pb-4">
              <span className="text-[10px] font-mono uppercase text-gray-500">Asset</span>
              <span className="font-bold text-white">Base USDC</span>
            </div>
            <button
              onClick={isConnected ? handlePay : () => connect({ connector: connectors[0] })}
              disabled={isPaying || (isConnected && !walletClient)}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-black font-black uppercase py-5 text-sm tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {isPaying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : !isConnected ? (
                "Connect to Pay"
              ) : (
                "Process Payment"
              )}
            </button>
          </div>

          {builderCode.trim().startsWith('bc_') && (
            <div className="flex items-center gap-3 bg-black/50 p-3 border border-emerald-500/10">
              <div className="animate-pulse w-2 h-2 rounded-full bg-emerald-500 shrink-0"></div>
              <p className="text-[10px] font-mono text-gray-400 uppercase truncate">
                Extension: BuilderCodeClient Active ({builderCode.trim()})
              </p>
            </div>
          )}

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
