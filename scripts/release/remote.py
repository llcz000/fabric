"""Versioned Fabric release executor. JSON protocol, no arbitrary shell commands."""
import datetime,gzip,hashlib,json,os,pathlib,re,shutil,subprocess,sys,tarfile,time,urllib.error,urllib.request

def must(value,message):
    if not value:raise RuntimeError(message)
def sha(file):return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def writable(value):
    must(isinstance(value,dict) and value.get('mode')=='v2' and ('readOnly' not in value or value['readOnly'] is False),'Writable runtime contract failed')
def http_contract(value):
    route=lambda p:isinstance(p,str) and re.fullmatch(r'/[a-z0-9]+(?:[-/][a-z0-9]+)*',p) is not None
    must(isinstance(value,dict) and set(value)=={'version','retiredRoutes','anonymousDenied'} and value['version']==1,'Invalid release HTTP contract')
    retired=value['retiredRoutes'];denied=value['anonymousDenied']
    must(isinstance(retired,list) and bool(retired) and isinstance(denied,list) and bool(denied),'Invalid release HTTP contract')
    must(all(isinstance(r,dict) and set(r)=={'path','status'} and route(r['path']) and r['status'] in [404,410] for r in retired) and all(route(p) for p in denied),'Invalid release HTTP contract')
    paths=[r['path'] for r in retired]+denied;must(len(set(paths))==len(paths),'Duplicate release HTTP contract route')
    return value

def failure_response(error,state=None):
    result={'ok':False,'error':str(error)}
    if state and state.get('automaticRollback'):result['automaticRollback']=state['automaticRollback']
    return result

def preserved_columns(before,after,migrations):
    if before==after:return True
    if 'pattern-number-reuse' in migrations:
        old=before.splitlines();new=after.splitlines()
        key=['pattern_masters','active_master_no']
        added=[line for line in new if line.split('\t')[:2]==key]
        if not any(line.split('\t')[:2]==key for line in old):
            if len(added)!=1 or added[0].split('\t')[2:]!=['varchar(64)','YES','NULL','STORED GENERATED']:return False
            after='\n'.join(line for line in new if line.split('\t')[:2]!=key)
            if before==after:return True
    if 'pattern-deletion' in migrations:
        old=before.splitlines();new=after.splitlines()
        key=['pattern_masters','deleted_at']
        added=[line for line in new if line.split('\t')[:2]==key]
        if not any(line.split('\t')[:2]==key for line in old):
            if len(added)!=1 or added[0].split('\t')[2:]!=['datetime','YES','NULL','']:return False
            after='\n'.join(line for line in new if line.split('\t')[:2]!=key)
            if before==after:return True
    if 'fabric-deletion' in migrations:
        old=before.splitlines();new=after.splitlines()
        key=['v2_fabrics','deleted_at']
        added=[line for line in new if line.split('\t')[:2]==key]
        if not any(line.split('\t')[:2]==key for line in old):
            if len(added)!=1 or added[0].split('\t')[2:]!=['datetime','YES','NULL','']:return False
            after='\n'.join(line for line in new if line.split('\t')[:2]!=key)
            if before==after:return True
    if 'customer-v12' not in migrations:return False
    a=before.splitlines();b=after.splitlines()
    if len(a)!=len(b):return False
    changed=0
    for old,new in zip(a,b):
        if old==new:continue
        x=old.split('\t');y=new.split('\t')
        if len(x)!=6 or len(y)!=6 or x[:2]!=['orders','receiving_unit'] or y[:2]!=x[:2] or x[3:]!=y[3:]:return False
        width=re.fullmatch(r'varchar\((\d+)\)',x[2])
        if not width or int(width[1])>=160 or y[2]!='varchar(160)':return False
        changed+=1
    return changed==1
def safe_extract(archive,folder,expected_sha):
    must(sha(archive)==expected_sha,'Archive digest mismatch')
    with tarfile.open(archive,'r:gz') as tar:
        for m in tar.getmembers():
            must((folder/m.name).resolve().is_relative_to(folder) and (m.isfile() or m.isdir()),'Unsafe archive member')
            must(m.name.startswith('./') or not m.name.startswith('/'),'Absolute archive member')
        tar.extractall(folder)

class Release:
    def __init__(self,request):
        self.r=request;self.p=request['profile'];self.b=request.get('baseline');self.id=request.get('id');self.archive_sha=request.get('archiveSha256');self.manifest_sha=request.get('manifestSha256')
        p=self.p
        for k in ['production','stageRoot','backupRoot','nginx']:
            value=p[k];must(isinstance(value,str) and re.fullmatch(r'/[\w/.-]+',value) and pathlib.PurePosixPath(value).as_posix()==value and '..' not in pathlib.PurePosixPath(value).parts and len(pathlib.PurePosixPath(value).parts)>2,'Unsafe target path')
        must(p['production']!=p['stageRoot'] and not p['stageRoot'].startswith(p['production']+'/'),'Overlapping directories')
        for k in ['process','recoveryProcess','starter','database']:must(re.fullmatch(r'[A-Za-z0-9_-]+(?:\.cjs)?',p[k]) is not None,'Unsafe identity')
        must(re.fullmatch(r'[a-f0-9-]{36}',p['serverUuid']) is not None,'Invalid database UUID')
        must(p['url'].startswith('https://') and '@' not in p['url'],'Invalid public URL')
        for k in ['port','recoveryPort']:must(type(p[k]) is int and 1024<=p[k]<=65535,'Invalid port')
        self.prod=pathlib.Path(p['production']);self.local='http://127.0.0.1:'+str(p['port']);self.recovery='http://127.0.0.1:'+str(p['recoveryPort'])
        if self.id:
            must(re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}',self.id) is not None,'Unsafe release ID')
            self.stage=pathlib.Path(p['stageRoot'])/self.id
            self.state_path=self.stage/'state.json'
            self.state=json.loads(self.state_path.read_text()) if self.state_path.exists() else {'id':self.id,'phases':{}}
        self.token=None
    def save(self):
        self.stage.mkdir(mode=0o700,parents=True,exist_ok=True)
        tmp=self.state_path.with_suffix('.next');tmp.write_text(json.dumps(self.state,indent=2));os.replace(tmp,self.state_path)
    def sql(self,sql,database=None):
        r=subprocess.run(['mysql','--batch','--skip-column-names',database or self.p['database']],input=sql,text=True,capture_output=True,timeout=90)
        must(r.returncode==0,'MySQL operation failed');return r.stdout.strip()
    def request(self,base,path,method='GET',payload=None,token=None):
        headers={'Content-Type':'application/json'} if payload is not None else {}
        if token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,method=method,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=20) as r:return r.status,r.read()
        except urllib.error.HTTPError as e:return e.code,e.read()
    def obj(self,base,path,token=None):
        code,raw=self.request(base,path,token=token);must(code==200,'Read failed '+path);v=json.loads(raw);must(isinstance(v,dict),'Expected JSON object');return v
    def runtimes(self):
        writable(self.obj(self.local,'/api/runtime'))
        h=self.obj(self.local,'/api/health');must(h.get('storage')=='mysql' and h.get('mode')=='v2' and h.get('status')=='ok','MySQL health failed')
        r=self.obj(self.recovery,'/api/runtime');must(r.get('mode')=='v2' and r.get('readOnly') is True,'Recovery runtime contract failed')
    def processes(self):
        items=json.loads(subprocess.check_output(['pm2','jlist'],timeout=30));main=[i for i in items if i['name']==self.p['process']];recovery=[i for i in items if i['name']==self.p['recoveryProcess']]
        must(len(main)==len(recovery)==1,'PM2 process identity mismatch');m=main[0]['pm2_env'];must(m['pm_cwd']==str(self.prod) and m['pm_exec_path']==str(self.prod/self.p['starter']) and m['status']=='online' and recovery[0]['pm2_env']['status']=='online','PM2 target mismatch')
        return {'productionPid':main[0]['pid'],'recoveryPid':recovery[0]['pid']}
    def inventory(self):
        self.runtimes();writable(self.obj(self.p['url'],'/api/runtime'));must(self.sql('SELECT @@server_uuid')==self.p['serverUuid'],'Physical database identity mismatch')
        return {'index':sha(self.prod/'dist/index.html'),'backend':sha(self.prod/'dist/server.cjs'),'starter':sha(self.prod/self.p['starter']),'nginx':sha(self.p['nginx']),'serverUuid':self.p['serverUuid'],'processes':self.processes()}
    def baseline(self):
        actual=self.inventory();must(self.b is not None,'Verified local baseline required')
        for k in ['index','backend','starter','nginx','serverUuid']:must(actual[k]==self.b[k],'Production baseline drift: '+k)
        return actual
    def login(self):
        if self.token:return self.token
        secret=json.loads((self.prod/'production-admin.local.json').read_text());code,raw=self.request(self.local,'/api/v2/access/login','POST',{'username':secret['username'],'password':secret['password']});must(code==200,'Existing production authentication failed');self.token=json.loads(raw)['token'];return self.token
    def preflight(self):
        actual=self.baseline();self.obj(self.local,'/api/v2/pattern-catalog?limit=1&offset=0',self.login());return actual
    def load(self):
        must(re.fullmatch(r'[a-f0-9]{64}',self.archive_sha or '') is not None,'Archive identity required')
        must(re.fullmatch(r'[a-f0-9]{64}',self.manifest_sha or '') is not None and sha(self.stage/'manifest.json')==self.manifest_sha,'Frozen manifest changed')
        m=json.loads((self.stage/'manifest.json').read_text());must(m.get('kind')=='fabric-release-v1' and m['id']==self.id and m['profile']==self.p and m['baseline']==self.b,'Manifest target drift')
        must(sha(self.stage/'release.tar.gz')==self.archive_sha,'Frozen archive changed')
        for n,v in m['files'].items():
            must(re.fullmatch(r'[A-Za-z0-9_./-]+',n) is not None and '..' not in pathlib.PurePosixPath(n).parts and not n.startswith('/'),'Unsafe manifest filename')
            f=self.stage/n;must(f.is_file() and not f.is_symlink() and sha(f)==v['sha256'] and f.stat().st_size==v['size'],'Frozen file drift: '+n)
        must(m['browserFiles'] and all(n in m['files'] and (n=='dist/index.html' or n in ['dist/favicon.svg','dist/favicon.ico'] or re.fullmatch(r'dist/assets/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)',n)) for n in m['browserFiles']),'Invalid browser file manifest')
        return m
    def unpack(self):
        self.stage.mkdir(mode=0o700,parents=True,exist_ok=True);safe_extract(self.stage/'release.tar.gz',self.stage,self.archive_sha);m=self.load();return {'archiveSha256':self.archive_sha,'files':len(m['files'])}
    def columns(self,tables):
        must(all(re.fullmatch(r'[A-Za-z0-9_]+',t) for t in tables),'Unsafe table inventory')
        return self.sql("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ("+','.join("'"+t+"'" for t in tables)+") ORDER BY TABLE_NAME,ORDINAL_POSITION")
    def backup(self):
        self.load();self.baseline();folder=pathlib.Path(self.p['backupRoot'])/('release-'+self.id);must(not folder.exists(),'Backup directory already exists without receipt; inspect status')
        folder.mkdir(mode=0o700,parents=True);tables=self.sql('SHOW TABLES').splitlines();columns=self.columns(tables);(self.stage/'old-columns.txt').write_text(columns)
        for name,key in [('index.html','index'),('server.cjs','backend')]:shutil.copy2(self.prod/'dist'/name,folder/name);must(sha(folder/name)==self.b[key],'Program backup mismatch')
        dumpfile=folder/'database.sql.gz'
        with dumpfile.open('xb') as raw:
            with gzip.GzipFile(fileobj=raw,mode='wb') as z:
                proc=subprocess.Popen(['mysqldump','--single-transaction','--quick','--skip-lock-tables','--no-tablespaces','--set-gtid-purged=OFF',self.p['database']],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                shutil.copyfileobj(proc.stdout,z);proc.stdout.close();err=proc.stderr.read();must(proc.wait(timeout=300)==0,'Consistent SQL backup failed')
        must(dumpfile.stat().st_size>1000,'Backup unexpectedly small')
        with gzip.open(dumpfile,'rb') as z:
            must(b'MySQL dump' in z.read(512),'Backup header missing')
            while z.read(1048576):pass
        key=folder/'passphrase.local';key.write_text(os.urandom(48).hex());encrypted=folder/'database.sql.gz.enc'
        subprocess.run(['openssl','enc','-aes-256-cbc','-pbkdf2','-salt','-in',str(dumpfile),'-out',str(encrypted),'-pass','file:'+str(key)],check=True,capture_output=True,timeout=60)
        return {'folder':str(folder),'sqlSha256':sha(dumpfile),'bytes':dumpfile.stat().st_size,'encrypted':str(encrypted),'encryptedSha256':sha(encrypted),'key':str(key),'tables':tables,'createdAt':time.time()}
    def verified_backup(self):
        b=self.state['phases'].get('backup',{});must(b.get('status')=='passed','Completed backup required');b=b['result'];folder=pathlib.Path(b['folder']);must(folder==pathlib.Path(self.p['backupRoot'])/('release-'+self.id),'Backup path drift');must(sha(folder/'database.sql.gz')==b['sqlSha256'],'SQL backup changed');must(sha(folder/'server.cjs')==self.b['backend'] and sha(folder/'index.html')==self.b['index'],'Program backup changed');return b
    def offsite(self):
        b=self.verified_backup();proof=self.r.get('offsite',{});must(proof.get('verified') is True and proof.get('encryptedSha256')==b['encryptedSha256'] and proof.get('decryptedSha256')==b['sqlSha256'],'Offsite readback proof missing');return proof
    def operator(self,mode,database,b,m):
        must(m['migrations'],'No registered migrations requested')
        plans=subprocess.run(['node',str(self.stage/'operator.cjs'),'plans',database,self.p['serverUuid'],b['sqlSha256'],','.join(m['migrations'])],text=True,capture_output=True,timeout=30)
        must(plans.returncode==0 and json.loads(plans.stdout)==m['migrationPlans'],'Registered migration plan drift')
        r=subprocess.run(['node',str(self.stage/'operator.cjs'),mode,database,self.p['serverUuid'],b['sqlSha256'],','.join(m['migrations'])],text=True,capture_output=True,timeout=180)
        (self.stage/('migration-'+mode+'.log')).write_text(r.stdout+r.stderr);must(r.returncode==0,'Registered migration/rehearsal failed; inspect server migration log');return json.loads(r.stdout.strip().splitlines()[-1])
    def rehearse(self):
        m=self.load();b=self.verified_backup();db='fabric_release_check_'+self.archive_sha[:16];must(self.sql("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='"+db+"'")=='','Rehearsal database exists')
        self.sql('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')
        try:
            with gzip.open(pathlib.Path(b['folder'])/'database.sql.gz','rb') as z:
                proc=subprocess.Popen(['mysql',db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);shutil.copyfileobj(z,proc.stdin);proc.stdin.close();out=proc.stdout.read();err=proc.stderr.read();must(proc.wait(timeout=300)==0,'Actual SQL restore failed')
            tables=self.sql('SHOW TABLES',db).splitlines();must(tables==b['tables'],'Restored table set mismatch')
            checked=self.sql('CHECK TABLE '+','.join('`'+t+'`' for t in tables),db);must(all(x.endswith('\tstatus\tOK') for x in checked.splitlines()),'Restored table check failed')
            migration=self.operator('rehearse',db,b,m) if m['migrations'] else None
            return {'database':db,'restoredTables':len(tables),'migration':migration,'backupSha256':b['sqlSha256'],'isolated':True}
        finally:
            must(db.startswith('fabric_release_check_') and re.fullmatch(r'fabric_release_check_[a-f0-9]{16}',db) is not None and db!=self.p['database'],'Unsafe rehearsal cleanup')
            self.sql('DROP DATABASE `'+db+'`')
    def atomic(self,source,dest):
        temp=dest.with_name(dest.name+'.release-next');must(not temp.exists(),'Unresolved atomic staging file');shutil.copy2(source,temp);os.replace(temp,dest)
    def restart(self):
        r=subprocess.run(['pm2','restart',self.p['process']],capture_output=True,timeout=40);must(r.returncode==0,'Production restart failed')
        for i in range(60):
            try:self.runtimes();return
            except Exception:time.sleep(.4)
        raise RuntimeError('Production health did not recover')
    def rollback(self):
        m=self.load();b=self.verified_backup();folder=pathlib.Path(b['folder']);backend=sha(self.prod/'dist/server.cjs');index=sha(self.prod/'dist/index.html')
        must(backend in [m['files']['dist/server.cjs']['sha256'],self.b['backend']] and index in [m['files']['dist/index.html']['sha256'],self.b['index']],'Refuse rollback over another release')
        must(sha(folder/'server.cjs')==self.b['backend'] and sha(folder/'index.html')==self.b['index'],'Rollback program backup changed')
        self.atomic(folder/'index.html',self.prod/'dist/index.html');self.atomic(folder/'server.cjs',self.prod/'dist/server.cjs');self.restart();self.baseline()
        code,body=self.request(self.p['url'],'/index.html');must(code==200 and hashlib.sha256(body).hexdigest()==self.b['index'],'Public rollback index verification failed')
        return {'state':'code-rolled-back','databaseRestored':False,'newTablesAndBusinessWritesPreserved':True}
    def verify(self):
        m=self.load();actual=self.inventory();must(actual['index']==m['files']['dist/index.html']['sha256'] and actual['backend']==m['files']['dist/server.cjs']['sha256'],'Installed version drift');must(actual['starter']==self.b['starter'] and actual['nginx']==self.b['nginx'],'Startup/nginx drift')
        if self.state['phases'].get('preflight',{}).get('result',{}).get('processes'):must(actual['processes']['recoveryPid']==self.state['phases']['preflight']['result']['processes']['recoveryPid'],'Recovery process changed')
        writable(self.obj(self.p['url'],'/api/runtime'));h=self.obj(self.p['url'],'/api/health');must(h.get('storage')=='mysql' and h.get('mode')=='v2','Public MySQL health failed')
        for n in m['browserFiles']:
            code,raw=self.request(self.p['url'],'/'+n[5:]);must(code==200 and hashlib.sha256(raw).hexdigest()==m['files'][n]['sha256'],'Public resource byte mismatch '+n)
        token=self.login()
        for route in ['/pattern-catalog','/products','/fabrics','/sample-cards','/customer-samples/sessions','/customers']:self.obj(self.local,'/api/v2'+route+'?limit=1&offset=0',token)
        contract=http_contract(json.loads((self.stage/'http-contract.json').read_text()));retired={}
        for route in contract['retiredRoutes']:
            code=self.request(self.local,'/api/v2'+route['path']+'?limit=1&offset=0',token=token)[0]
            must(code==route['status'],'Retired route contract failed '+route['path']);retired[route['path']]=code
        for route in contract['anonymousDenied']:must(self.request(self.p['url'],'/api/v2'+route)[0]==401,'Anonymous route contract failed '+route)
        must(self.obj(self.local,'/api/v2/customers/capability',token).get('enabled') is True,'Customer capability disabled');must(self.obj(self.local,'/api/v2/pattern-sharing',token).get('cardsEnabled') is True,'Card sharing disabled')
        for route,method,payload,expected in [('/api/products','GET',None,410),('/api/v2/customers','POST',{'invalid':1},401),('/api/v2/sample-cards/1/share','POST',{},401),('/server.cjs','GET',None,404),('/server.cjs.map','GET',None,404),('/.env','GET',None,404),('/api/public/cards/invalid','GET',None,404)]:must(self.request(self.p['url'],route,method,payload)[0]==expected,'Public access contract failed '+route)
        b=self.verified_backup();must(preserved_columns((self.stage/'old-columns.txt').read_text(),self.columns(b['tables']),m['migrations']),'Existing table columns changed')
        return {'state':'verified','browserFiles':len(m['browserFiles']),'authenticatedReads':6,'retiredRoutes':retired,'defaultTlsValidation':True,'browserUiAcceptance':'pending','version':{'index':actual['index'],'backend':actual['backend']}}
    def deploy(self):
        m=self.load();self.baseline();b=self.verified_backup();must(time.time()-b['createdAt']<21600,'Backup is older than six hours')
        must(self.state['phases'].get('offsite',{}).get('status')=='passed','Verified offsite backup required')
        if m['migrations'] or m['rehearse']:must(self.state['phases'].get('rehearse',{}).get('status')=='passed','Actual restore rehearsal required')
        migration=None;changed=False
        try:
            if m['migrations']:migration=self.operator('migrate',self.p['database'],b,m)
            must(preserved_columns((self.stage/'old-columns.txt').read_text(),self.columns(b['tables']),m['migrations']),'Migration changed existing columns')
            for n in m['browserFiles']:
                if n=='dist/index.html':continue
                dest=self.prod/n;dest.parent.mkdir(parents=True,exist_ok=True)
                if dest.exists():must(sha(dest)==m['files'][n]['sha256'],'Immutable resource collision')
                else:self.atomic(self.stage/n,dest)
            self.baseline();self.atomic(self.stage/'dist/server.cjs',self.prod/'dist/server.cjs');changed=True;self.restart()
            self.obj(self.local,'/api/v2/pattern-catalog?limit=1&offset=0',self.login());self.atomic(self.stage/'dist/index.html',self.prod/'dist/index.html')
            verified=self.verify();return {'state':'released','migration':migration,'verification':verified,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        except Exception:
            if changed:
                try:self.state['automaticRollback']=self.rollback();self.save()
                except Exception as error:self.state['automaticRollback']={'state':'guarded-rollback-failed','error':str(error)};self.save()
            raise
    def dispatch(self,action):
        if action=='inventory':return self.inventory()
        if action=='status':return {'state':self.state,'inventory':self.inventory()}
        if action=='stage':
            must(not self.stage.exists() or self.state.get('archiveSha256')==self.archive_sha,'Stage identity conflict')
            self.state['archiveSha256']=self.archive_sha;self.save();return {'stage':str(self.stage)}
        methods={'preflight':self.preflight,'unpack':self.unpack,'backup':self.backup,'offsite':self.offsite,'rehearse':self.rehearse,'deploy':self.deploy,'verify':self.verify,'rollback':self.rollback}
        must(action in methods,'Unknown remote action');old=self.state['phases'].get(action)
        if old and old['status']=='passed':
            if action in ['unpack','backup','offsite','rehearse','deploy','verify']:self.load()
            if action=='backup':self.verified_backup()
            if action in ['deploy','verify']:self.verify()
            if action=='rollback':self.baseline()
            return old['result']
        must(not old or self.r.get('resume') is True,'Previous phase failed or uncertain; inspect status and explicitly resume')
        if old and old['status']=='running' and action in ['backup','rehearse','deploy','rollback']:raise RuntimeError('Mutation outcome uncertain; manual status/guarded rollback required')
        self.state['phases'][action]={'status':'running'};self.save()
        try:
            result=methods[action]();self.state['phases'][action]={'status':'passed','result':result};self.save();return result
        except Exception as e:self.state['phases'][action]={'status':'failed','error':str(e)};self.save();raise
    def close(self):
        if self.token:
            try:self.request(self.local,'/api/v2/access/logout','POST',{},self.token)
            except Exception:pass

def main():
    import base64,fcntl
    os.umask(0o077);request=json.loads(base64.b64decode(sys.argv[1]));release=Release(request)
    with open('/var/lock/fabric-v2-release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:print(json.dumps({'ok':True,'result':release.dispatch(request['action'])}))
        except Exception as e:print(json.dumps(failure_response(e,release.state)));return 1
        finally:release.close()
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:print(json.dumps(failure_response(e)));sys.exit(1)
