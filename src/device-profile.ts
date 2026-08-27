export type ChannelPosition = "top" | "bottom";

export interface MotorChannelProfile {
  type: 1 | 3 | 4;
  semanticKey: "secondary_thrust" | "suction" | "thrust";
  semanticNameZh: "二次抽插" | "吮吸" | "抽插";
  pageLabelZh: "震动" | "吮吸" | "抽插";
  position: ChannelPosition;
  mcpTool: "set_secondary_thrust" | "set_suction" | "set_thrust";
  aliasesZh: string[];
}

export interface DeviceProfile {
  deviceId: string;
  code: string;
  nameZh: string;
  nameEn: string;
  channels: readonly MotorChannelProfile[];
}

const TUTU_II_PROFILE: DeviceProfile = {
  deviceId: "18",
  code: "QCTT",
  nameZh: "突突二代",
  nameEn: "TUTU II",
  channels: [
    {
      type: 1,
      semanticKey: "secondary_thrust",
      semanticNameZh: "二次抽插",
      pageLabelZh: "震动",
      position: "top",
      mcpTool: "set_secondary_thrust",
      aliasesZh: ["震动", "顶部", "顶部通道", "二次抽插"],
    },
    {
      type: 4,
      semanticKey: "thrust",
      semanticNameZh: "抽插",
      pageLabelZh: "抽插",
      position: "bottom",
      mcpTool: "set_thrust",
      aliasesZh: ["抽插", "底部", "底部通道", "主抽插"],
    },
  ],
};

const CATHY_III_PROFILE: DeviceProfile = {
  deviceId: "17",
  code: "KX02",
  nameZh: "Cathy III",
  nameEn: "Cathy III",
  channels: [
    {
      type: 3,
      semanticKey: "suction",
      semanticNameZh: "吮吸",
      pageLabelZh: "吮吸",
      position: "top",
      mcpTool: "set_suction",
      aliasesZh: ["吮吸", "吸吮", "顶部", "顶部通道"],
    },
    {
      type: 4,
      semanticKey: "thrust",
      semanticNameZh: "抽插",
      pageLabelZh: "抽插",
      position: "bottom",
      mcpTool: "set_thrust",
      aliasesZh: ["抽插", "底部", "底部通道", "主抽插"],
    },
  ],
};

const DEVICE_PROFILES: Readonly<Record<string, DeviceProfile>> = {
  [TUTU_II_PROFILE.deviceId]: TUTU_II_PROFILE,
  [CATHY_III_PROFILE.deviceId]: CATHY_III_PROFILE,
};

export function getDeviceProfile(deviceId: string): DeviceProfile | undefined {
  return DEVICE_PROFILES[deviceId];
}

export function getMotorChannelProfile(
  deviceId: string,
  type: number,
): MotorChannelProfile | undefined {
  return getDeviceProfile(deviceId)?.channels.find((channel) => channel.type === type);
}
