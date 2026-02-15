import TypedEmitter from "typed-emitter";
import { Room } from "livekit-client";
import { VoiceChatEventCallbacks } from "./events";
import { VoiceChatConfig, VoiceChatState } from "./types";
declare const VoiceChat_base: new () => TypedEmitter<VoiceChatEventCallbacks>;
export declare class VoiceChat extends VoiceChat_base {
    private readonly room;
    private _state;
    private track;
    constructor(room: Room);
    private get isConnected();
    get state(): VoiceChatState;
    get isMuted(): boolean;
    start(config?: VoiceChatConfig): Promise<void>;
    stop(): void;
    mute(): Promise<void>;
    unmute(): Promise<void>;
    setDevice(deviceId: ConstrainDOMString): Promise<boolean>;
    private set state(value);
}
export {};
