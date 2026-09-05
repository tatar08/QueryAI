import { backendTransport } from '../transports/runtime';
import { createWindowTitleAdapter } from './windowTitle';

export const windowTitleAdapter = createWindowTitleAdapter({
  mode: backendTransport.kind,
});
