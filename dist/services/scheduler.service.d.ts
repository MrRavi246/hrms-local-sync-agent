export declare class SchedulerService {
    private static instance;
    private syncTimer;
    private heartbeatTimer;
    private isRunning;
    private constructor();
    static getInstance(): SchedulerService;
    /**
     * Starts all recurring timers (heartbeat + attendance poll)
     */
    start(): Promise<void>;
    /**
     * Single heartbeat tick
     */
    tickHeartbeat(): Promise<void>;
    /**
     * Single attendance poll tick
     */
    tickSync(): Promise<void>;
    /**
     * Stops all active timers
     */
    stop(): void;
}
export declare const schedulerService: SchedulerService;
