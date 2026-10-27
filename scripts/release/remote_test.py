import contextlib,hashlib,importlib.util,io,json,pathlib,shutil,sys,tarfile,time,unittest,uuid
sys.dont_write_bytecode=True
from unittest.mock import Mock
spec=importlib.util.spec_from_file_location('release_remote',pathlib.Path(__file__).with_name('remote.py'));remote=importlib.util.module_from_spec(spec);spec.loader.exec_module(remote)
PathContract=pathlib.Path(__file__).with_name('http-contract.json')
h=lambda b:hashlib.sha256(b).hexdigest()
@contextlib.contextmanager
def fixture_directory():
    base=(pathlib.Path.cwd()/'tmp/release-tool-tests').resolve();base.mkdir(parents=True,exist_ok=True)
    target=base/('fixture-'+uuid.uuid4().hex);target.mkdir(mode=0o777)
    try:yield str(target)
    finally:
        assert target.resolve().parent==base and target.name.startswith('fixture-')
        shutil.rmtree(target)

class ReleaseTests(unittest.TestCase):
    def test_product_card_supplement_repeats_after_restart_before_new_index(self):
        with fixture_directory() as directory:
            stage=pathlib.Path(directory);(stage/'old-columns.txt').write_text('cols');(stage/'dist').mkdir();(stage/'dist/server.cjs').write_bytes(b'new');(stage/'dist/index.html').write_bytes(b'html')
            r=remote.Release.__new__(remote.Release);r.prod=stage/'prod';r.stage=stage;r.local='http://127.0.0.1';r.p={'database':'fabric_db'};r.state={'phases':{'offsite':{'status':'passed'},'rehearse':{'status':'passed'}}}
            r.load=Mock(return_value={'migrations':['product-auto-cards'],'migrationPlans':{'product-auto-cards':'sha'},'rehearse':True,'browserFiles':[]});r.baseline=Mock();r.verified_backup=Mock(return_value={'createdAt':time.time(),'tables':[]});r.columns=Mock(return_value='cols');r.login=Mock(return_value='token');r.verify=Mock(return_value={})
            events=[];r.operator=Mock(side_effect=lambda *args:events.append(('migrate',args[3]['migrations'])) or {});r.restart=Mock(side_effect=lambda:events.append(('restart',None)));r.obj=Mock(return_value={});r.atomic=Mock(side_effect=lambda src,dest:events.append(('index' if dest.name=='index.html' else 'server',None)))
            r.deploy()
            self.assertEqual(events,[('migrate',['product-auto-cards']),('server',None),('restart',None),('migrate',['product-auto-cards']),('index',None)])
            self.assertEqual(r.operator.call_args_list[1].args[3]['migrationPlans'],{'product-auto-cards':'sha'})
    def test_versioned_favicon_is_an_immutable_allowlisted_resource(self):
        for name in ['dist/favicon-6dc80a36.svg','dist/favicon.svg','dist/favicon.ico','dist/assets/hashed-index.js']:
            self.assertTrue(remote.allowed_browser_file(name),name)
        for name in ['dist/favicon-other.svg','dist/favicon-123.svg','dist/favicon-FFFFFFFF.svg','dist/../favicon-6dc80a36.svg','dist/random.svg','dist/favicon-6dc80a36.html']:
            self.assertFalse(remote.allowed_browser_file(name),name)

    def test_pattern_reuse_allows_only_exact_generated_column(self):
        before='pattern_masters\tid\tbigint unsigned\tNO\tNULL\tauto_increment'
        added='pattern_masters\tactive_master_no\tvarchar(64)\tYES\tNULL\tSTORED GENERATED'
        after=before+'\n'+added
        self.assertTrue(remote.preserved_columns(before,after,['pattern-number-reuse']))
        self.assertFalse(remote.preserved_columns(before,after,[]))
        self.assertFalse(remote.preserved_columns(before,after.replace('varchar(64)','varchar(65)'),['pattern-number-reuse']))
        self.assertFalse(remote.preserved_columns(before,after.replace('STORED GENERATED',''),['pattern-number-reuse']))
        self.assertFalse(remote.preserved_columns(before,after.replace('bigint unsigned','int'),['pattern-number-reuse']))

    def test_pattern_deletion_allows_only_one_nullable_datetime_column(self):
        before='pattern_masters\tid\tbigint unsigned\tNO\tNULL\tauto_increment\nv2_products\tid\tbigint unsigned\tNO\tNULL\tauto_increment'
        added='pattern_masters\tdeleted_at\tdatetime\tYES\tNULL\t'
        after=before.replace('\nv2_products', '\n'+added+'\nv2_products')
        self.assertTrue(remote.preserved_columns(before,after,['pattern-deletion']))
        self.assertFalse(remote.preserved_columns(before,after,[]))
        self.assertFalse(remote.preserved_columns(before,after.replace('datetime','varchar(20)'),['pattern-deletion']))
        self.assertFalse(remote.preserved_columns(before,after.replace('\tYES\t','\tNO\t'),['pattern-deletion']))
        self.assertFalse(remote.preserved_columns(before,after.replace('bigint unsigned','int'),['pattern-deletion']))

    def test_fabric_deletion_allows_only_one_nullable_datetime_column(self):
        before='v2_fabrics\tid\tbigint unsigned\tNO\tNULL\tauto_increment\nv2_products\tid\tbigint unsigned\tNO\tNULL\tauto_increment'
        added='v2_fabrics\tdeleted_at\tdatetime\tYES\tNULL\t'
        after=before.replace('\nv2_products', '\n'+added+'\nv2_products')
        self.assertTrue(remote.preserved_columns(before,after,['fabric-deletion']))
        self.assertFalse(remote.preserved_columns(before,after,[]))
        self.assertFalse(remote.preserved_columns(before,after.replace('datetime','varchar(20)'),['fabric-deletion']))
        self.assertFalse(remote.preserved_columns(before,after.replace('\tYES\t','\tNO\t'),['fabric-deletion']))
        self.assertFalse(remote.preserved_columns(before,after.replace('bigint unsigned','int'),['fabric-deletion']))

    def test_customer_v12_allows_only_exact_name_capacity_expansion(self):
        before='orders\tid\tint\tNO\tNULL\tauto_increment\norders\treceiving_unit\tvarchar(100)\tYES\tNULL\t'
        after=before.replace('varchar(100)','varchar(160)')
        self.assertTrue(remote.preserved_columns(before,after,['customer-v12']))
        self.assertFalse(remote.preserved_columns(before,after,[]))
        self.assertFalse(remote.preserved_columns(before,after.replace('varchar(160)','varchar(159)'),['customer-v12']))
        self.assertFalse(remote.preserved_columns(before,after.replace('\tYES\t','\tNO\t'),['customer-v12']))
        self.assertFalse(remote.preserved_columns(before,after.replace('\tint\t','\tbigint\t'),['customer-v12']))
        self.assertTrue(remote.preserved_columns(after,after,['customer-v12']))
    def test_shared_http_contract_rejects_unsafe_or_success_status(self):
        value=json.loads(PathContract.read_text())
        self.assertEqual(remote.http_contract(value),value)
        for bad in [dict(value,version=2),dict(value,retiredRoutes=[{'path':'/customer-tasks','status':200}]),dict(value,anonymousDenied=['/customers?token=x']),dict(value,anonymousDenied=['/customer-tasks'])]:
            with self.assertRaises(RuntimeError):remote.http_contract(bad)
    def test_failure_response_includes_automatic_rollback_receipt(self):
        receipt={'state':'code-rolled-back','databaseRestored':False,'newTablesAndBusinessWritesPreserved':True}
        result=remote.failure_response(RuntimeError('contract failed'),{'automaticRollback':receipt})
        self.assertEqual(result,{'ok':False,'error':'contract failed','automaticRollback':receipt})
        self.assertEqual(remote.failure_response(RuntimeError('network')),{'ok':False,'error':'network'})
    def test_writable_runtime_contract(self):
        for item in [{'mode':'v2'},{'mode':'v2','readOnly':False}]:remote.writable(item)
        for item in [None,[],{'mode':'v2','readOnly':0},{'mode':'v2','readOnly':'false'},{'mode':'v2','readOnly':None},{'mode':'v2','readOnly':True}]:
            with self.assertRaises(RuntimeError):remote.writable(item)
    def test_archive_traversal_and_links_are_rejected_before_extraction(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('link',tarfile.SYMTYPE),('hardlink',tarfile.LNKTYPE)]:
            with fixture_directory() as directory:
                folder=pathlib.Path(directory);archive=folder/'release.tar.gz'
                with tarfile.open(archive,'w:gz') as tar:
                    info=tarfile.TarInfo(name);info.type=kind;info.linkname='/etc/passwd';info.size=0;tar.addfile(info,io.BytesIO())
                with self.assertRaises(RuntimeError):remote.safe_extract(archive,folder,remote.sha(archive))
    def test_migration_cannot_install_without_restore_rehearsal(self):
        r=remote.Release.__new__(remote.Release);r.load=Mock(return_value={'migrations':['light-customers'],'rehearse':False});r.baseline=Mock();r.verified_backup=Mock(return_value={'createdAt':time.time()});r.state={'phases':{'offsite':{'status':'passed'}}};r.operator=Mock()
        with self.assertRaisesRegex(RuntimeError,'restore rehearsal'):r.deploy()
        r.operator.assert_not_called()
    def test_missing_offsite_readback_blocks_all_installation(self):
        r=remote.Release.__new__(remote.Release);r.load=Mock(return_value={'migrations':[],'rehearse':False});r.baseline=Mock();r.verified_backup=Mock(return_value={'createdAt':time.time()});r.state={'phases':{}}
        with self.assertRaisesRegex(RuntimeError,'offsite'):r.deploy()
    def test_public_failure_automatically_rolls_back_code(self):
        with fixture_directory() as directory:
            root=pathlib.Path(directory);prod=root/'prod';stage=root/'stage';(prod/'dist').mkdir(parents=True);(stage/'dist').mkdir(parents=True);(stage/'dist/server.cjs').write_bytes(b'new');(stage/'dist/index.html').write_bytes(b'new-html');(prod/'dist/server.cjs').write_bytes(b'old');(prod/'dist/index.html').write_bytes(b'old-html');(stage/'old-columns.txt').write_text('columns')
            r=remote.Release.__new__(remote.Release);r.prod=prod;r.stage=stage;r.local='http://local';r.state={'phases':{'offsite':{'status':'passed'}}};r.b={'backend':h(b'old'),'index':h(b'old-html')};r.load=Mock(return_value={'migrations':[],'rehearse':False,'browserFiles':['dist/index.html'],'files':{'dist/server.cjs':{'sha256':h(b'new')},'dist/index.html':{'sha256':h(b'new-html')}}});r.baseline=Mock();r.verified_backup=Mock(return_value={'createdAt':time.time(),'tables':['old_table']});r.columns=Mock(return_value='columns');r.restart=Mock();r.obj=Mock();r.login=Mock();r.verify=Mock(side_effect=RuntimeError('public SHA mismatch'));r.rollback=Mock(return_value={'state':'code-rolled-back','databaseRestored':False});r.save=Mock()
            with self.assertRaisesRegex(RuntimeError,'public SHA'):r.deploy()
            r.rollback.assert_called_once();self.assertFalse(r.state['automaticRollback']['databaseRestored'])
    def test_guarded_rollback_never_overwrites_a_different_release(self):
        with fixture_directory() as directory:
            prod=pathlib.Path(directory);(prod/'dist').mkdir();(prod/'dist/server.cjs').write_bytes(b'peer-release');(prod/'dist/index.html').write_bytes(b'old-html')
            r=remote.Release.__new__(remote.Release);r.prod=prod;r.b={'backend':h(b'old'),'index':h(b'old-html')};r.load=Mock(return_value={'files':{'dist/server.cjs':{'sha256':h(b'new')},'dist/index.html':{'sha256':h(b'new-html')}}});r.verified_backup=Mock(return_value={'folder':directory});r.atomic=Mock()
            with self.assertRaisesRegex(RuntimeError,'another release'):r.rollback()
            r.atomic.assert_not_called()
    def test_successful_code_rollback_preserves_database(self):
        with fixture_directory() as directory:
            root=pathlib.Path(directory);prod=root/'prod';backup=root/'backup';(prod/'dist').mkdir(parents=True);backup.mkdir()
            for name,new,old in [('server.cjs',b'new',b'old'),('index.html',b'new-html',b'old-html')]:
                (prod/'dist'/name).write_bytes(new);(backup/name).write_bytes(old)
            r=remote.Release.__new__(remote.Release);r.prod=prod;r.b={'backend':h(b'old'),'index':h(b'old-html')};r.load=Mock(return_value={'files':{'dist/server.cjs':{'sha256':h(b'new')},'dist/index.html':{'sha256':h(b'new-html')}}});r.verified_backup=Mock(return_value={'folder':str(backup)});r.restart=Mock();r.baseline=Mock();r.sql=Mock()
            r.p={'url':'https://example.test'};r.request=Mock(return_value=(200,b'old-html'))
            result=r.rollback();self.assertEqual((prod/'dist/server.cjs').read_bytes(),b'old');self.assertFalse(result['databaseRestored']);r.sql.assert_not_called()
    def test_completed_install_receipt_verifies_instead_of_reinstalling(self):
        r=remote.Release.__new__(remote.Release);r.state={'phases':{'deploy':{'status':'passed','result':{'state':'released'}}}};r.r={};r.load=Mock();r.verify=Mock();r.deploy=Mock()
        self.assertEqual(r.dispatch('deploy'),{'state':'released'});r.verify.assert_called_once();r.deploy.assert_not_called()
    def test_uncertain_mutation_cannot_be_blindly_retried(self):
        r=remote.Release.__new__(remote.Release);r.state={'phases':{'deploy':{'status':'running'}}};r.r={'resume':True};r.deploy=Mock()
        with self.assertRaisesRegex(RuntimeError,'uncertain'):r.dispatch('deploy')
        r.deploy.assert_not_called()

if __name__=='__main__':unittest.main()
