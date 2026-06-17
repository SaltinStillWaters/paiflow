"use client";

type WalletPickerProps = {
  onPick: (mode: "seamless" | "extension") => void;
  onCancel: () => void;
};

export default function WalletPicker({ onPick, onCancel }: WalletPickerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="bg-surface border-outline-variant w-full max-w-sm rounded-2xl border p-6">
        <p className="font-display text-on-surface mb-1 text-xl font-semibold">Sign transaction</p>
        <p className="text-body-sm text-on-surface-variant mb-6 font-mono">Choose how to sign</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => onPick("seamless")}
            className="border-outline-variant bg-surface-container hover:bg-surface-container-high flex items-start gap-4 rounded-xl border p-4 text-left transition-colors"
          >
            <span className="material-symbols-outlined text-primary mt-0.5 text-[24px]">
              fingerprint
            </span>
            <div>
              <p className="text-label-md text-on-surface font-mono font-bold">PASSKEY WALLET</p>
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                Sign with your device passkey. Your private key never leaves this device.
              </p>
            </div>
          </button>
          <button
            onClick={() => onPick("extension")}
            className="border-outline-variant bg-surface-container hover:bg-surface-container-high flex items-start gap-4 rounded-xl border p-4 text-left transition-colors"
          >
            <span className="material-symbols-outlined text-secondary mt-0.5 text-[24px]">
              account_balance_wallet
            </span>
            <div>
              <p className="text-label-md text-on-surface font-mono font-bold">BROWSER EXTENSION</p>
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                Use Freighter or another Stellar wallet extension.
              </p>
            </div>
          </button>
        </div>
        <button
          onClick={onCancel}
          className="text-label-sm text-on-surface-variant hover:text-on-surface mt-4 w-full font-mono transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
