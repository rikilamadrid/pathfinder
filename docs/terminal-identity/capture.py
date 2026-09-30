#!/usr/bin/env python3
"""Capture the unchanged real CLI in disposable directories using real PTYs."""
from pathlib import Path
import importlib.util, json, tempfile, subprocess
root=Path(__file__).resolve().parents[2]
out=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('support',out/'capture-support.py')
support=importlib.util.module_from_spec(spec); spec.loader.exec_module(support)
command=['node',str(root/'packages/create-pathfinder/bin/create-pathfinder.mjs')]
entries=[]
with tempfile.TemporaryDirectory(prefix='pathfinder-visual-') as cwd:
 subprocess.run(['git','init','-q',cwd],check=True)
 for name,columns,env,args in [('wide',110,{},['--dry-run','--yes']),('narrow',42,{},['--dry-run','--yes']),('legacy-narrow-32',32,{},['--dry-run','--yes']),('no-color',110,{'NO_COLOR':'1'},['--dry-run','--yes']),('ascii',110,{'WW_ASCII':'1'},['--dry-run','--yes']),('ansi256',110,{'COLORTERM':''},['--dry-run','--yes']),('ansi16',110,{'COLORTERM':'','TERM':'xterm'},['--dry-run','--yes']),('dumb',110,{'TERM':'dumb'},['--dry-run','--yes']),('help',110,{},['--help'])]:
  item=support.save(out,name,command+args,cwd,columns,env)
  item['command']=['node','packages/create-pathfinder/bin/create-pathfinder.mjs']+args
  entries.append(item)
with tempfile.TemporaryDirectory(prefix='pathfinder-noarg-') as cwd:
 item=support.save(out,'no-arg',command,cwd,110,{'NO_COLOR':'1','PATHFINDER_PROMPT':'classic'},'n\n')
 item['command']=['node','packages/create-pathfinder/bin/create-pathfinder.mjs']
 entries.append(item)
(out/'manifest.json').write_text(json.dumps({'kind':'unchanged real product CLI','sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'captures':entries},indent=2)+'\n')
