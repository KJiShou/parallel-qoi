export type RunConfig={backend:'serial'|'openmp'|'cuda'|'mpi';rows:500|1000|2000|4000;cols:500|1000|2000|4000;steps:100;density:.6|.7|.8;seed:42;repetitions:1|3;threads?:4;processes?:4;blockSize?:256};
export type LiveTrace={schemaVersion:2;sourceRows:number;sourceCols:number;previewRows:500;previewCols:500;aggregationRows:number;aggregationCols:number;steps:number;frameInterval:number;density:number;seed:number;frames:{step:number;cells2BitBase64:string;burningMaskBase64:string}[]};
export type RunEvent={type:'started'|'log'|'completed'|'failed'|'cancelled'|'trace-completed'|'trace-failed';runId:string;backend?:string;line?:string;stream?:'stdout'|'stderr';message?:string;result?:any;trace?:LiveTrace};
export type DesktopApi={getCapabilities:()=>Promise<any>;startRun:(config:RunConfig)=>Promise<{runId:string}>;startTrace:(config:Pick<RunConfig,'rows'|'cols'|'density'|'seed'>&{traceSteps:number})=>Promise<{runId:string}>;cancelRun:(runId:string)=>Promise<boolean>;listRuns:()=>Promise<any[]>;readRun:(id:string)=>Promise<any>;onRunEvent:(listener:(event:RunEvent)=>void)=>()=>void};
declare global { interface Window { wildfireDesktop?:DesktopApi } }
export {};
