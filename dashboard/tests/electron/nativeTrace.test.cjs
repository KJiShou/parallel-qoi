const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const rootDir=path.resolve(__dirname,'..','..','..');
const serial=path.join(rootDir,'build_verified','Release','wildfire_serial.exe');

test('serial trace writes compressed schema version 2 for a 500 grid',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wildfire-trace-'));
  const tracePath=path.join(directory,'trace.json');
  execFileSync(serial,['--rows','500','--cols','500','--steps','5','--density','0.7','--seed','42','--repetitions','1','--warmup','0','--frames',tracePath,'--frame-interval','5'],{cwd:rootDir,stdio:'pipe'});
  const trace=JSON.parse(fs.readFileSync(tracePath,'utf8'));
  assert.equal(trace.schemaVersion,2);
  assert.equal(trace.sourceRows,500);
  assert.equal(trace.sourceCols,500);
  assert.equal(trace.previewRows,500);
  assert.equal(trace.previewCols,500);
  assert.equal(trace.aggregationRows,1);
  assert.equal(trace.aggregationCols,1);
  assert.ok(trace.frames.every((frame)=>typeof frame.cells2BitBase64==='string'&&!('cells' in frame)));
});

test('serial trace aggregates a 1000 grid into fixed 500 preview frames',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wildfire-trace-'));
  const tracePath=path.join(directory,'trace.json');
  execFileSync(serial,['--rows','1000','--cols','1000','--steps','5','--density','0.7','--seed','42','--repetitions','1','--warmup','0','--frames',tracePath,'--frame-interval','5','--trace-only'],{cwd:rootDir,stdio:'pipe'});
  const trace=JSON.parse(fs.readFileSync(tracePath,'utf8'));
  assert.equal(trace.previewRows,500);
  assert.equal(trace.previewCols,500);
  assert.equal(trace.aggregationRows,2);
  assert.equal(trace.aggregationCols,2);
  assert.deepEqual(trace.frames.map((frame)=>frame.step),[0,5]);
  for(const frame of trace.frames) assert.equal(Buffer.from(frame.cells2BitBase64,'base64').length,62500);
});
