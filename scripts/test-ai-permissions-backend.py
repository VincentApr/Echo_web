"""Run real Jarvis permission models/serializers against an in-memory database.

Only unrelated messaging/group models use small fixtures. No real DB, migration
command, Redis, LLM, network request or account is used.
Requires Django 5.1 and djangorestframework in the executing environment.
"""
import sys
import tempfile
from pathlib import Path
import unittest

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='echo-ai-tests-') as directory:
    fixtures = Path(directory)
    for app in ('groups', 'messaging'):
        (fixtures / app).mkdir()
        (fixtures / app / '__init__.py').write_text('')
    (fixtures / 'groups/models.py').write_text('''
from django.db import models
from django.contrib.auth.models import User
User.add_to_class('ai_agents_enabled', models.BooleanField(default=True))
class Group(models.Model):
    name = models.CharField(max_length=100)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
class GroupMember(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    is_banned = models.BooleanField(default=False)
''')
    (fixtures / 'messaging/models.py').write_text('''
from django.db import models
class Conversation(models.Model):
    participants = models.ManyToManyField('auth.User')
    group = models.ForeignKey('groups.Group', null=True, on_delete=models.CASCADE)
    conversation_type = models.CharField(max_length=30, default='direct')
class Message(models.Model):
    sender = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    content = models.TextField(default='')
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
''')
    sys.path[:0] = [str(fixtures), str(root / 'backend-server')]
    from django.conf import settings
    settings.configure(SECRET_KEY='isolated-tests', USE_TZ=True,
                       DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
                       INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes', 'groups', 'messaging', 'jarvis'])
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection
    with connection.schema_editor() as editor:
        for model in apps.get_models():
            editor.create_model(model)
    if '--serve' in sys.argv:
        import json
        from http.server import BaseHTTPRequestHandler, HTTPServer
        from django.contrib.auth import get_user_model
        from jarvis.models import JarvisInstance
        from jarvis.views import JarvisInstanceView
        from rest_framework.test import APIRequestFactory, force_authenticate
        from rest_framework.fields import BooleanField
        user = get_user_model().objects.create(username='Aperçu local')
        JarvisInstance.objects.create(user=user)
        def profile():
            user.refresh_from_db()
            return dict(uuid='11111111-1111-4111-8111-111111111111', username=user.username,
                        email='apercu@example.test', has_accepted_cgu=True,
                        ai_agents_enabled=user.ai_agents_enabled, ai_policy_version=1)
        class PreviewHandler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def handle_request(self):
                path = self.path.split('?')[0]
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                data = json.loads(raw) if raw else {}
                status = 200
                if path == '/api/auth/profile/':
                    if self.command == 'PATCH':
                        user.ai_agents_enabled = BooleanField().run_validation(data['ai_agents_enabled'])
                        user.save(update_fields=['ai_agents_enabled'])
                    result = profile()
                elif path == '/jarvis/instance/':
                    factory = APIRequestFactory()
                    request = getattr(factory, self.command.lower())(path, data=data, format='json')
                    force_authenticate(request, user=user)
                    response = JarvisInstanceView.as_view()(request)
                    result, status = response.data, response.status_code
                elif path.startswith('/jarvis/'):
                    result, status = {'detail': 'Simulation locale : aucun service IA n’est appelé.'}, 403
                else:
                    result = []
                body = json.dumps(result, ensure_ascii=False, default=str).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            do_GET = do_POST = do_PATCH = handle_request
        port = int(sys.argv[sys.argv.index('--serve') + 1])
        server = HTTPServer(('127.0.0.1', port), PreviewHandler)
        print(f'API de simulation prête sur 127.0.0.1:{port}', flush=True)
        server.serve_forever()

    suite = unittest.defaultTestLoader.loadTestsFromName('jarvis.test_permissions')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
