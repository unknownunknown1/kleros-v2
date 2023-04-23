import { InjectedConnector } from "@web3-react/injected-connector";
import { SUPPORTED_CHAINIDS } from "consts/chains";

export const injected = new InjectedConnector({
  supportedChainIds: SUPPORTED_CHAINIDS,
});
