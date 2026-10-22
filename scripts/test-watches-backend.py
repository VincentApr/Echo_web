"""Watch API tests/preview using SQLite in memory. Never uses the real database.
The real watch app, Relation model and GroupInvitation model/methods are loaded.
Unrelated user/group/messaging infrastructure uses small fixtures.
"""
import ast
import sys
import tempfile
from pathlib import Path
import unittest

root = Path(__file__).resolve().parents[1]
backend = root / 'backend-server'
with tempfile.TemporaryDirectory(prefix='echo-watches-') as directory:
    fixtures = Path(directory)
    for app in ('groups', 'messaging', 'relations', 'jarvis', 'mistral_tools', 'agent'):
        (fixtures / app).mkdir()
        (fixtures / app / '__init__.py').write_text(f"__path__.append({str(backend / app)!r})\n")
        (fixtures / app / 'apps.py').write_text(f"from django.apps import AppConfig\nclass FixtureConfig(AppConfig):\n    name = '{app}'\n")
    group_source = (backend / 'groups/models.py').read_text()
    invitation = next(node for node in ast.parse(group_source).body if isinstance(node, ast.ClassDef) and node.name == 'GroupInvitation')
    (fixtures / 'groups/models.py').write_text('''
import uuid
from datetime import timedelta
from django.db import models
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.contrib.auth.models import User
User.add_to_class('uuid', models.UUIDField(default=uuid.uuid4, unique=True))
User.add_to_class('ai_agents_enabled', models.BooleanField(default=True))
class Group(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(default='')
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    is_active = models.BooleanField(default=True)
    max_members = models.IntegerField(default=100)
    def can_add_members(self): return self.memberships.filter(is_banned=False).count() < self.max_members
class GroupMember(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    is_banned = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    invited_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    role = models.CharField(max_length=20, default='member')
    class Meta: unique_together = [('group', 'user')]
''' + ast.get_source_segment(group_source, invitation))
    (fixtures / 'messaging/models.py').write_text('''
import uuid
from django.db import models
class Conversation(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    group = models.ForeignKey('groups.Group', null=True, on_delete=models.CASCADE, related_name='conversations')
    participants = models.ManyToManyField('auth.User', through='ConversationParticipant')
    conversation_type = models.CharField(max_length=20, default='direct')
    framework_agent = models.ForeignKey('agent.AiAgent_Framework', null=True, on_delete=models.CASCADE)
class ConversationParticipant(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='conversation_participants')
    user = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    is_archived = models.BooleanField(default=False)
    class Meta: unique_together = [('conversation', 'user')]
class Message(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    content = models.TextField()
    is_ai_generated = models.BooleanField(default=False)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
''')
    (fixtures / 'agent/models.py').write_text('''
import uuid
from django.db import models
class AiAgent_Framework(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(default='')
    created_by = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    is_active = models.BooleanField(default=True)
    visibility = models.CharField(max_length=10, default='private')
class AgentFavorite(models.Model):
    user = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    agent = models.ForeignKey(AiAgent_Framework, on_delete=models.CASCADE)
''')
    service_source = (backend / 'messaging/services.py').read_text()
    agent_service = next(node for node in ast.parse(service_source).body if isinstance(node, ast.ClassDef) and node.name == 'AgentConversationService')
    (fixtures / 'messaging/services.py').write_text('''
from django.db import transaction
from agent.models import AiAgent_Framework
from .models import Conversation, ConversationParticipant
''' + ast.get_source_segment(service_source, agent_service))
    jarvis_source = (backend / 'jarvis/models.py').read_text()
    jarvis = next(node for node in ast.parse(jarvis_source).body if isinstance(node, ast.ClassDef) and node.name == 'JarvisInstance')
    (fixtures / 'jarvis/models.py').write_text('''
import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
User = get_user_model()
''' + ast.get_source_segment(jarvis_source, jarvis))
    (fixtures / 'mistral_tools/models.py').write_text('''
import uuid
from django.db import models
class OAuthProvider(models.Model):
    name = models.CharField(max_length=50, unique=True)
    is_active = models.BooleanField(default=True)
class UserOAuthConnection(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    user = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    provider = models.ForeignKey(OAuthProvider, on_delete=models.CASCADE)
    is_valid = models.BooleanField(default=True)
    granted_scopes = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)
    def get_valid_access_token(self): return 'fixture-token-only'
''')
    sys.path[:0] = [str(fixtures), str(backend)]
    from django.conf import settings
    settings.configure(SECRET_KEY='watch-fixtures', USE_TZ=True, ROOT_URLCONF='watches.urls',
        DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
        MISTRAL_API_KEY='fixture-key-only',
        INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes', 'groups', 'messaging', 'relations', 'jarvis', 'mistral_tools', 'agent', 'watches'])
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection
    with connection.schema_editor() as editor:
        for model in apps.get_models(): editor.create_model(model)
    if '--serve' in sys.argv:
        import json
        from datetime import timedelta
        from http.server import HTTPServer, BaseHTTPRequestHandler
        from django.contrib.auth import get_user_model
        from django.utils import timezone
        from rest_framework.test import APIRequestFactory, force_authenticate
        from watches.views import WatchListView, WatchDetailView, WatchRefreshView
        from watches.preferences import WatchPreferencesView, WatchSubscriptionView, WatchPresenceView, WatchArtworkView
        from relations.models import Relation
        from groups.models import Group, GroupInvitation
        from messaging.models import Conversation, ConversationParticipant
        user = get_user_model().objects.create(username='Camille', first_name='Camille')
        lucas = get_user_model().objects.create(username='Lucas', first_name='Lucas', last_name='Martin')
        lea = get_user_model().objects.create(username='Léa', first_name='Léa', last_name='Moreau')
        Relation.objects.create(demandeur=lucas, destinataire=user, message='Salut Camille ! On s’est croisés à la soirée de Léa. Ça me ferait plaisir de garder le contact ici.')
        Relation.objects.create(demandeur=lea, destinataire=user, message='On se retrouve sur Echo ?')
        group = Group.objects.create(name='Les escapades du week-end', created_by=lucas, description='Des idées de sorties, un peu de grand air et de bons moments ensemble.')
        GroupInvitation.objects.create(group=group, created_by=lucas, target_user=user, message='On organise notre prochaine sortie samedi. Tu viens avec nous ?', expires_at=timezone.now()+timedelta(days=6))
        conv = Conversation.objects.create()
        ConversationParticipant.objects.create(conversation=conv, user=user)
        ConversationParticipant.objects.create(conversation=conv, user=lucas)
        intelligent = '--intelligent' in sys.argv
        if intelligent:
            from jarvis.models import JarvisInstance
            from mistral_tools.models import OAuthProvider, UserOAuthConnection
            from messaging.models import Message
            from watches.collectors import SCOPES
            from watches.engine import request_scan, process_one
            from watches.test_engine import fake_services
            JarvisInstance.objects.create(user=user)
            provider = OAuthProvider.objects.create(name='google')
            UserOAuthConnection.objects.create(user=user, provider=provider,
                granted_scopes=[next(iter(SCOPES['email_thread'])), next(iter(SCOPES['calendar_event']))])
            Message.objects.create(conversation=conv, sender=lucas, content='Pour notre sortie samedi, tu préfères le départ à 9 h ou à 10 h ?')
            if '--agents' in sys.argv:
                from agent.models import AiAgent_Framework
                AiAgent_Framework.objects.create(created_by=user, name='Recherche de stage',
                    description='Aide à préparer les candidatures de stage, réponses aux recruteurs et entretiens.')
            if '--experience' in sys.argv:
                github_provider=OAuthProvider.objects.create(name='github')
                UserOAuthConnection.objects.create(user=user,provider=github_provider,granted_scopes=['notifications'])
            request_scan(user)
        def profile():
            return dict(uuid=str(user.uuid), username=user.username, first_name=user.first_name,
                email='apercu@example.test', has_accepted_cgu=True, ai_agents_enabled=user.ai_agents_enabled,
                preview_pinned_uuid=str(conv.uuid))
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def handle_request(self):
                path = self.path.split('?')[0]
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                data = json.loads(raw) if raw else {}
                status = 200
                if path == '/api/auth/profile/':
                    if self.command == 'PATCH' and 'ai_agents_enabled' in data:
                        user.ai_agents_enabled = bool(data['ai_agents_enabled']); user.save()
                    result = profile()
                elif path == '/watches/refresh/':
                    factory = APIRequestFactory()
                    request = getattr(factory, self.command.lower())(self.path, data=data, format='json')
                    force_authenticate(request, user=user)
                    response = WatchRefreshView.as_view()(request)
                    result, status = response.data, response.status_code
                elif path in ('/watches/preferences/','/watches/presence/','/watches/subscriptions/'):
                    view={'/watches/preferences/':WatchPreferencesView,'/watches/presence/':WatchPresenceView,'/watches/subscriptions/':WatchSubscriptionView}[path]
                    request=getattr(APIRequestFactory(),self.command.lower())(self.path,data=data,format='json')
                    force_authenticate(request,user=user)
                    response=view.as_view()(request)
                    result,status=response.data,response.status_code
                elif path.startswith('/watches/') and path.endswith('/artwork/'):
                    request=APIRequestFactory().get(self.path);force_authenticate(request,user=user)
                    response=WatchArtworkView.as_view()(request,uuid=path.split('/')[2])
                    result,status=(response.data if hasattr(response,'data') else bytes(response.content)),response.status_code
                elif path.startswith('/watches/'):
                    factory = APIRequestFactory()
                    request = getattr(factory, self.command.lower())(self.path, data=data, format='json')
                    force_authenticate(request, user=user)
                    uuid = path.removeprefix('/watches/').strip('/')
                    response = WatchDetailView.as_view()(request, uuid=uuid) if uuid else WatchListView.as_view()(request)
                    result, status = response.data, response.status_code
                elif path == '/messaging/conversations/private/':
                    result = [dict(uuid=str(conv.uuid), name='Lucas', conversation_type='direct', unread_count=0, other_participant=dict(uuid=str(lucas.uuid), username='Lucas'))]
                elif path == f'/messaging/conversations/{conv.uuid}/':
                    result = dict(uuid=str(conv.uuid), conversation_type='direct', unread_count=1,
                        other_participant=dict(uuid=str(lucas.uuid), username='Lucas'))
                elif path == '/messaging/conversations/agents/':
                    result = [dict(uuid=str(thread.uuid), conversation_type='ai_agent', unread_count=0,
                        framework_agent=dict(uuid=str(thread.framework_agent.uuid), name=thread.framework_agent.name, avatar_url=''))
                        for thread in Conversation.objects.filter(participants=user, conversation_type='ai_agent').select_related('framework_agent')]
                elif path == '/tools/oauth/status/':
                    result=[dict(provider=connection.provider.name,granted_scopes=connection.granted_scopes)
                        for connection in UserOAuthConnection.objects.filter(user=user,is_valid=True).select_related('provider')] if intelligent else []
                elif path.startswith('/tools/oauth/'):
                    result,status={'detail':'La connexion à un compte réel est désactivée dans cet aperçu fictif.'},403
                elif path == '/jarvis/instance/' and intelligent:
                    from jarvis.permissions import effective_permissions
                    instance = JarvisInstance.objects.get(user=user)
                    if self.command == 'PATCH':
                        if 'is_active' in data: instance.is_active = bool(data['is_active'])
                        if 'permissions' in data: instance.permission_overrides = {**instance.permission_overrides, **data['permissions']}
                        instance.save()
                    result = dict(is_active=instance.is_active, default_language='fr', permission_schema_version=1,
                        permissions=effective_permissions(instance))
                elif path.startswith('/jarvis/'):
                    result, status = {'detail': 'Aucun service IA n’est appelé dans cet aperçu.'}, 403
                else: result = []
                binary=isinstance(result,bytes)
                body = b'' if status == 204 else result if binary else json.dumps(result, ensure_ascii=False, default=str).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'image/webp' if binary else 'application/json; charset=utf-8')
                self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers(); self.wfile.write(body)
            do_GET = do_POST = do_PATCH = do_DELETE = handle_request
        port = int(sys.argv[sys.argv.index('--serve')+1])
        print(f'API de veilles prête sur 127.0.0.1:{port}', flush=True)
        server = HTTPServer(('127.0.0.1', port), Handler)
        if intelligent:
            server.timeout = .2
            with fake_services(group_related='--group-topics' in sys.argv):
                while True:
                    server.handle_request()
                    process_one()
                    if '--experience' in sys.argv:
                        from watches.models import WatchItem,WatchArtwork
                        from watches.artwork import normalize,input_digest,COVER_FORMAT
                        samples = {
                            'topic':('career','Une porte s’ouvre','Votre candidature'),
                            'github_notification':('github','À vous de jouer','Revue GitHub'),
                            'echo_conversation':('weekend','Prendre le large','Sortie du week-end'),
                        }
                        for item in WatchItem.objects.filter(owner=user,kind__in=samples,source_status='pending',handled_at__isnull=True):
                            image,_=WatchArtwork.objects.get_or_create(watch=item)
                            if image.layout == COVER_FORMAT and image.input_digest == input_digest(item) and image.published_at:
                                continue
                            filename,title,subtitle=samples[item.kind]
                            image.content=normalize((root/f'src/dev/watch-covers/assets/{filename}.png').read_bytes())
                            image.theme='code' if filename=='github' else 'career' if filename=='career' else 'travel'
                            image.layout=COVER_FORMAT;image.input_digest=input_digest(item)
                            image.title=title;image.subtitle=subtitle;image.published_at=timezone.now()
                            image.save()

        else:
            server.serve_forever()
    suite = unittest.defaultTestLoader.loadTestsFromNames(['watches.tests', 'watches.test_engine', 'watches.test_topics', 'watches.test_agents', 'watches.test_artwork_push', 'watches.test_github'])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
