export declare class HealthServer {
    private static instance;
    private server;
    private startTime;
    private constructor();
    static getInstance(): HealthServer;
    /**
     * Starts local diagnostic HTTP server
     */
    start(): Promise<void>;
    /**
     * Stops local diagnostic server
     */
    stop(): Promise<void>;
}
export declare const healthServer: HealthServer;
