import "server-only";
import {
  Address,
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { sorobanRpc, decodeContractAddress } from "./client";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type PreparedInvoke = {
  xdr: string;
};

export async function preparePaymentTx(opts: {
  contractAddress: string;
  amount: string;
  sourceAccount: string;
}): Promise<PreparedInvoke> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.sourceAccount);

  const nativeAssetContractId = Asset.native().contractId(stellarPassphrase());
  const assetContractIdBytes = decodeContractAddress(nativeAssetContractId);
  const assetScAddress = xdr.ScAddress.scAddressTypeContract(
    assetContractIdBytes as unknown as xdr.Hash,
  );

  const fromScVal = new Address(opts.sourceAccount).toScVal();
  const toScVal = new Address(opts.contractAddress).toScVal();
  const amountScVal = nativeToScVal(BigInt(opts.amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: assetScAddress,
      functionName: "transfer",
      args: [fromScVal, toScVal, amountScVal],
    }),
  );

  const op = Operation.invokeHostFunction({ func: hostFunction });

  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR() };
}
