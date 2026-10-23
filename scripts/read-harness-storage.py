#!/usr/bin/env python3
"""Fixed readonly DSH storage operations. No config, credentials, repair or locks."""
import base64,json,os,re,stat,sys
SAFE=re.compile(r'^[A-Za-z0-9._~-]{1,255}$')
GEN=re.compile(r'^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$')
MAX_FILE=16*1024*1024
class Denied(Exception):pass

def directory(parent,name):
    return os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
def root_directory(path):
    if not isinstance(path,str) or not path.startswith('/') or os.path.normpath(path)!=path or path.startswith('//') or '\\' in path or '\0' in path:raise Denied()
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.split('/')[1:]:
            if not part or part in ('.','..'):raise Denied()
            newer=directory(fd,part);os.close(fd);fd=newer
        return fd
    except:os.close(fd);raise

def nested(parent,parts):
    fd=os.dup(parent)
    try:
        for part in parts:
            if not SAFE.fullmatch(part) or part in ('.','..'):raise Denied()
            newer=directory(fd,part);os.close(fd);fd=newer
        return fd
    except:os.close(fd);raise

def read_file(parent,name,maximum=MAX_FILE,prefix=False):
    if not SAFE.fullmatch(name) or name in ('.','..'):raise Denied()
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or (not prefix and before.st_size>maximum):raise Denied()
        chunks=[];remaining=min(before.st_size,maximum)
        while remaining:
            chunk=os.read(fd,min(remaining,65536))
            if not chunk:raise Denied()
            chunks.append(chunk);remaining-=len(chunk)
        after=os.fstat(fd)
        fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if fields(before)!=fields(after):raise Denied()
        return b''.join(chunks),{'size':before.st_size,'mtime_ms':before.st_mtime_ns/1000000}
    finally:os.close(fd)

def workspaces(root,path):
    fd=nested(root,['storages'])
    try:raw,_=read_file(fd,'workspace.json',4*1024*1024)
    finally:os.close(fd)
    virtual=[]
    for name in ('memory','skills'):
        try:fd=directory(root,name)
        except FileNotFoundError:continue
        except OSError:raise Denied()
        else:os.close(fd);virtual.append({'name':name,'path':path+'/'+name})
    return {'document':json.loads(raw.decode('utf-8')),'virtual':virtual}

def title_hint(value):
    if not isinstance(value,dict):return None
    identity=value.get('identity');title=value.get('rows',{}).get('title')
    if not isinstance(identity,dict) or not isinstance(title,dict):return None
    if isinstance(title.get('val'),str) and len(title['val'].encode('utf-8'))>8192:return None
    return {'identity':{k:identity[k]for k in ('formatVersion','createdAt','cwd','isSeeded','inheritedEventCount')if k in identity},'title':{k:title[k]for k in ('ver','seq','val')if k in title}}

def legacy_titles(root):
    # Listing-only stale title hints; never bootstrap, merge or rewrite a storage unit.
    try:
        fd=nested(root,['storages'])
        try:raw,_=read_file(fd,'session_projcache.json',4*1024*1024)
        finally:os.close(fd)
        document=json.loads(raw.decode('utf-8'))
        unit=document.get('unit',{})
        if unit.get('name')!='session_projcache' or unit.get('version')not in(3,4,5,6,7):return {}
        rows=document.get('tables',{}).get('sessions',{})
        if not isinstance(rows,dict) or len(rows)>5000:return {}
        return {key:title_hint(value)for key,value in rows.items()if re.fullmatch(r'[A-Za-z0-9_-]{1,256}',key)}
    except Exception:return {}

def cached_title(root,key):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,256}',key):return None
    try:
        fd=nested(root,['storages','session_projcache','sessions'])
        try:raw,_=read_file(fd,key+'.json',4*1024*1024)
        finally:os.close(fd)
        document=json.loads(raw.decode('utf-8'))
        if document.get('version') not in (3,4,5,6,7):return None
        return title_hint(document.get('record',{}))
    except Exception:return None

def catalog(root):
    try:base=nested(root,['sessions'])
    except FileNotFoundError:return {'items':[]}
    items=[];prefix_bytes=0;legacy=legacy_titles(root)
    try:
        for project in sorted(os.listdir(base)):
            if not SAFE.fullmatch(project) or project in ('.','..'):continue
            try:pfd=directory(base,project)
            except OSError:continue
            try:
                for session in sorted(os.listdir(pfd)):
                    if not SAFE.fullmatch(session) or session in ('.','..'):continue
                    try:sfd=directory(pfd,session)
                    except OSError:continue
                    try:
                        choices=[]
                        for name in os.listdir(sfd):
                            match=GEN.fullmatch(name)
                            if not match:continue
                            st=os.stat(name,dir_fd=sfd,follow_symlinks=False)
                            if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1:raise Denied()
                            choices.append((int(match.group(1) or 0),name))
                        if not choices:continue
                        choices.sort(reverse=True)
                        if len(choices)>1 and choices[0][0]==choices[1][0]:raise Denied()
                        version,name=choices[0]
                        data,metadata=read_file(sfd,name,65536,True)
                        prefix_bytes+=len(data)
                        if len(items)>=5000 or prefix_bytes>16*1024*1024:raise Denied()
                        items.append({'artifact':'sessions/'+project+'/'+session+'/'+name,'version':version,'header_prefix':base64.b64encode(data).decode('ascii'),'title_cache':cached_title(root,session),'legacy_title_cache':legacy.get(session),**metadata})
                    finally:os.close(sfd)
            finally:os.close(pfd)
    finally:os.close(base)
    return {'items':items}

def artifact(root,path):
    if not isinstance(path,str):raise Denied()
    parts=path.split('/')
    if len(parts)!=4 or parts[0]!='sessions' or not GEN.fullmatch(parts[-1]):raise Denied()
    fd=nested(root,parts[:-1])
    try:data,metadata=read_file(fd,parts[-1])
    finally:os.close(fd)
    return {'bytes':base64.b64encode(data).decode('ascii'),**metadata}

def plugins(root):
    fd=nested(root,['profiles','desktop'])
    try:raw,_=read_file(fd,'package.json',1024*1024)
    finally:os.close(fd)
    document=json.loads(raw.decode('utf-8'))
    dependencies=document.get('dependencies',{})
    if not isinstance(dependencies,dict) or len(dependencies)>2000:raise Denied()
    entries=[]
    for name,version in sorted(dependencies.items()):
        if not isinstance(name,str) or len(name)>214 or not re.fullmatch(r'(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*',name):continue
        item={'moduleName':name,'source':'persisted_manifest'}
        if isinstance(version,str) and re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?',version):item['meta']={'version':version}
        entries.append(item)
    return {'entries':entries,'source':'persisted_manifest'}

def main():
    request=json.loads(sys.stdin.buffer.read(8193))
    if not isinstance(request,dict) or len(json.dumps(request).encode())>8192 or set(request)-{'home','operation','artifact'}:raise Denied()
    home=request.get('home');fd=root_directory(home)
    try:
        operation=request.get('operation')
        if operation=='workspaces' and 'artifact'not in request:return workspaces(fd,home)
        if operation=='catalog' and 'artifact'not in request:return catalog(fd)
        if operation=='plugins' and 'artifact'not in request:return plugins(fd)
        if operation=='artifact':return artifact(fd,request.get('artifact'))
        raise Denied()
    finally:os.close(fd)
try:
    value=main();sys.stdout.write(json.dumps(value,separators=(',',':'),ensure_ascii=True))
except Exception:
    sys.stdout.write('{"error":"Harness storage read denied"}')
