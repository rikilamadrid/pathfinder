#!/usr/bin/env python3
"""Compare actual non-TTY stdout/stderr/exit bytes against the audited revision."""
from pathlib import Path
import tempfile, subprocess, os, hashlib, json
root=Path(__file__).resolve().parents[2]
revision=json.loads((Path(__file__).parent/'manifest.json').read_text())['sourceRevision']
commands=[['--version'],['--help'],['--unknown'],['--json'],['--dry-run','--yes'],['--no-git-init','--yes']]
environments=[{}, {'NO_COLOR':'1'}, {'WW_ASCII':'1'}, {'TERM':'dumb'}, {'FORCE_COLOR':'3'}, {'COLORTERM':'truecolor'}, {'TERM':'xterm-256color'}]
records=[]
with tempfile.TemporaryDirectory(prefix='pathfinder-baseline-',dir='/private/tmp') as before, tempfile.TemporaryDirectory(prefix='pathfinder-contract-',dir='/private/tmp') as cwd:
 archive=subprocess.run(['git','archive',revision],cwd=root,check=True,stdout=subprocess.PIPE).stdout
 subprocess.run(['tar','xf','-','-C',before],input=archive,check=True)
 for env in environments:
  actual_env=dict(os.environ)
  for key in ['NO_COLOR','WW_ASCII','FORCE_COLOR','COLORTERM','CI']:
   actual_env.pop(key,None)
  actual_env.update({'LANG':'en_US.UTF-8',**env})
  for args in commands:
   results=[subprocess.run(['node',str(Path(repo)/'packages/create-pathfinder/bin/create-pathfinder.mjs'),*args],cwd=cwd,env=actual_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for repo in [before,root]]
   old,new=results
   assert (old.stdout,old.stderr,old.returncode)==(new.stdout,new.stderr,new.returncode),(env,args)
   records.append({'args':args,'env':env,'exitCode':new.returncode,'stdoutBytes':len(new.stdout),'stderrBytes':len(new.stderr),'stdoutSHA256':hashlib.sha256(new.stdout).hexdigest(),'stderrSHA256':hashlib.sha256(new.stderr).hexdigest(),'equal':True})
(Path(__file__).parent/'contract-proof.json').write_text(json.dumps({'baseline':revision,'comparisons':len(records),'allEqual':True,'results':records},indent=2)+'\n')
print(f'{len(records)} command/environment comparisons: stdout, stderr and exit code byte-equivalent')
