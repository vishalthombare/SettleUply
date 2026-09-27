import { environment } from './environment';

export type ApplicationType = 'WEB' | 'MOBILE';
export type ApplicationTypeSetting = ApplicationType | 'AUTO';

interface DeviceInfo {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile: boolean };
}

/** Client provenance only; never used for permissions or user identity. */
export function applicationType(
  setting: ApplicationTypeSetting = environment.APPLICATION_TYPE,
  device: DeviceInfo | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): ApplicationType {
  if (setting !== 'AUTO') return setting;
  if (!device) return 'WEB';
  const mobile =
    device.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent) ||
    (device.platform === 'MacIntel' && (device.maxTouchPoints ?? 0) > 1);
  return mobile ? 'MOBILE' : 'WEB';
}
