import { NativeModule, requireOptionalNativeModule } from "expo";

/** The native side: `android/src/main/java/org/eigenage/heartstrap/HeartStrapModule.kt`. */
export type StrapEvents = {
  onDevice: (e: { id: string; name: string; rssi: number }) => void;
  onState: (e: { state: "connecting" | "connected" | "disconnected"; id: string | null; name?: string; error?: string | null }) => void;
  onMeasurement: (e: { id: string; bytes: number[]; at: number }) => void;
};

declare class HeartStrapModule extends NativeModule<StrapEvents> {
  bluetooth(): "on" | "off" | "none";
  startScan(): void;
  stopScan(): void;
  connect(id: string): void;
  disconnect(): void;
}

/** Null where the module is not built in: anywhere but Android. */
export default requireOptionalNativeModule<HeartStrapModule>("HeartStrap");
