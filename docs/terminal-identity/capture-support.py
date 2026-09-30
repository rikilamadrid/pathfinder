import os, pty, fcntl, termios, struct, subprocess, select, time, json, pathlib, re

def capture(command, cwd, columns=110, env=None, answer=None):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 35, columns, 0, 0))
    base = dict(os.environ)
    for key in ['NO_COLOR','FORCE_COLOR','WW_ASCII','COLORTERM','CI']:
        base.pop(key, None)
    base.update({'TERM':'xterm-256color','LANG':'en_US.UTF-8','COLORTERM':'truecolor'})
    base.update(env or {})
    proc = subprocess.Popen(command, cwd=cwd, env=base, stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    raw = bytearray(); started=time.monotonic(); sent=False
    while True:
        if answer and not sent and time.monotonic()-started > .4:
            os.write(master, answer.encode()); sent=True
        ready,_,_=select.select([master],[],[],.1)
        if ready:
            try: data=os.read(master,65536)
            except OSError: break
            if not data: break
            raw.extend(data)
        if time.monotonic()-started > 15:
            proc.kill(); raise RuntimeError('capture timed out')
        if proc.poll() is not None and not ready: break
    proc.wait(); os.close(master)
    return bytes(raw), proc.returncode

def save(out, name, command, cwd, columns=110, env=None, answer=None):
    raw, code=capture(command,cwd,columns,env,answer)
    (out/(name+'.ansi')).write_bytes(raw)
    plain=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'',raw).decode().replace('\r\n','\n')
    (out/(name+'.txt')).write_text(plain)
    return {'name':name,'command':command,'columns':columns,'env':env or {},'exitCode':code,'bytes':len(raw),'input':answer}
