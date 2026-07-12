export type RunConfig={backend:'serial'|'openmp'|'cuda'|'mpi';rows:500|1000|2000|4000;cols:500|1000|2000|4000;steps:100|500|1000;density:.6|.7|.8;seed:number;repetitions:1|3|5;threads?:1|2|4|8|16;processes?:1|2|4|8;blockSize?:128|256|512|1024};
export type RunEvent={type:'started'|'log'|'completed'|'failed'|'cancelled';runId:string;backend?:string;line?:string;stream?:'stdout'|'stderr';message?:string;result?:any};
export type DesktopApi={getCapabilities:()=>Promise<any>;startRun:(config:RunConfig)=>Promise<{runId:string}>;cancelRun:(runId:string)=>Promise<boolean>;listRuns:()=>Promise<any[]>;readRun:(id:string)=>Promise<any>;onRunEvent:(listener:(event:RunEvent)=>void)=>()=>void};
declare global { interface Window { wildfireDesktop?:DesktopApi } }
export {};
