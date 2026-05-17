import { Connection } from '@solana/web3.js';

/** Creates a Solana RPC connection for verification. */
export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, 'confirmed');
}
