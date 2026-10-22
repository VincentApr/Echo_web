"""Real group models, serializers, views and guards; isolated SQLite database only.
Unrelated messaging/agent models and storage are small fixtures; no cloud/LLM calls.
"""
import ast
import sys
import tempfile
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
backend = root / 'backend-server'
with tempfile.TemporaryDirectory(prefix='echo-group-moderation-') as directory:
    fixtures = Path(directory)
    for app in ('groups', 'messaging', 'agent'):
        (fixtures / app).mkdir()
        (fixtures / app / '__init__.py').write_text(f'__path__.append({str(backend / app)!r})\n')
        (fixtures / app / 'apps.py').write_text(f"from django.apps import AppConfig\nclass FixtureConfig(AppConfig):\n    name='{app}'\n    default_auto_field='django.db.models.BigAutoField'\n")
    source = (backend / 'groups/models.py').read_text().replace('from storages.backends.s3boto3 import S3Boto3Storage', 'from django.core.files.storage import FileSystemStorage as S3Boto3Storage')
    (fixtures / 'groups/models.py').write_text(source)
    (fixtures / 'messaging/models.py').write_text('''
import uuid
from django.db import models
from django.contrib.auth.models import User
User.add_to_class('uuid', models.UUIDField(default=uuid.uuid4, unique=True))
User.add_to_class('surnom', models.CharField(max_length=100, default=''))
User.add_to_class('ai_agents_enabled', models.BooleanField(default=True))
User.photo_profil = property(lambda self: None)
class Conversation(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    group = models.ForeignKey('groups.Group', null=True, on_delete=models.CASCADE, related_name='conversations')
    conversation_type = models.CharField(max_length=30, default='group_chat')
    participants = models.ManyToManyField(User, through='ConversationParticipant')
    def get_other_participant(self, user): return None
class ConversationParticipant(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='conversation_participants')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    is_archived = models.BooleanField(default=False)
class Message(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField(default='')
    created_at = models.DateTimeField(auto_now_add=True)
    framework_agent = models.ForeignKey('agent.AiAgent_Framework', null=True, on_delete=models.CASCADE)
    is_ai_generated = models.BooleanField(default=False)
''')
    (fixtures / 'agent/models.py').write_text('''
import uuid
from django.db import models
class AiAgent_Framework(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True)
    name = models.CharField(max_length=100)
    created_by = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    is_active = models.BooleanField(default=True)
class ConversationAgentSettings(models.Model):
    conversation = models.ForeignKey('messaging.Conversation', on_delete=models.CASCADE)
    user = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    agent = models.ForeignKey(AiAgent_Framework, on_delete=models.CASCADE)
    is_automatic = models.BooleanField(default=False)
''')
    sys.path[:0] = [str(fixtures), str(backend)]
    from django.conf import settings
    settings.configure(SECRET_KEY='group-fixtures', USE_TZ=True, ROOT_URLCONF='groups.urls',
        DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
        INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes', 'groups', 'messaging', 'agent'])
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection
    with connection.schema_editor() as editor:
        for model in apps.get_models(): editor.create_model(model)
    from django.contrib.auth import get_user_model
    from django.utils import timezone
    from datetime import timedelta
    from rest_framework.test import APIRequestFactory, force_authenticate
    from groups.models import Group, GroupMember, GroupInvitation, GroupAgentBlock, GroupModerationLog
    from groups.views import GroupMemberDetailView, GroupAIPolicyView, GroupMemberAIBlockView, GroupDetailView
    from groups.moderation_views import group_moderation, group_agent_moderation
    from groups.moderation import require_group_write, require_group_agent
    from groups.serializers import GroupCodeJoinSerializer
    from agent.models import AiAgent_Framework, ConversationAgentSettings
    from messaging.models import ConversationParticipant, Message

    # Run the real HTTP send handlers and WebSocket permission check with unrelated relation services stubbed.
    import types
    from django.shortcuts import get_object_or_404
    from rest_framework import generics, permissions, status
    from rest_framework.response import Response
    from messaging.models import Conversation
    relation_utils = types.ModuleType('relations.utils')
    relation_utils.is_blocked = lambda *args: False
    relation_utils.get_relation_status = lambda *args: 'connecte'
    sys.modules['relations.utils'] = relation_utils
    view_source = (backend / 'messaging/views.py').read_text()
    send_views = {}
    namespace = dict(generics=generics, permissions=permissions, status=status, Response=Response,
        Conversation=Conversation, get_object_or_404=get_object_or_404,
        MessageCreateSerializer=object, MessageCreateWithAttachmentsSerializer=object)
    for node in ast.parse(view_source).body:
        if isinstance(node, ast.ClassDef) and node.name in ('MessageCreateView', 'MessageCreateWithAttachmentsView'):
            exec(ast.get_source_segment(view_source, node), namespace)
            send_views[node.name] = namespace[node.name]
    consumer_source = ast.parse((backend / 'messaging/consumers.py').read_text())
    consumer = next(n for n in consumer_source.body if isinstance(n, ast.ClassDef))
    method = next(n for n in consumer.body if isinstance(n, ast.FunctionDef) and n.name == 'check_messaging_permissions')
    method.decorator_list = []
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), '<real-consumer-permissions>', 'exec'), namespace)
    socket_permissions = namespace['check_messaging_permissions']

    import logging
    service_source = (backend / 'agent/services.py').read_text()
    service_node = next(node for node in ast.parse(service_source).body if isinstance(node, ast.ClassDef) and node.name == 'AgentService')
    service_namespace = {'__package__':'agent', 'logger':logging.getLogger('group-tests'),
        'require_conversation_ai': lambda *args: None, 'require_permission': lambda *args: None,
        'require_group_agent':require_group_agent}
    exec(ast.get_source_segment(service_source,service_node),service_namespace)
    AgentService = service_namespace['AgentService']

    class ModerationTests(unittest.TestCase):
        def setUp(self):
            Group.objects.all().delete()
            get_user_model().objects.all().delete()
            self.owner, self.mod, self.member, self.other, self.outsider = [get_user_model().objects.create(username=name) for name in ('Camille', 'Alex', 'Lucas', 'Léa', 'Max')]
            self.group = Group.objects.create(name='Escapades', created_by=self.owner, avatar=None)
            self.conversation = self.group.conversations.get()
            for user, role in ((self.mod, 'moderator'), (self.member, 'member'), (self.other, 'moderator')):
                GroupMember.objects.create(group=self.group, user=user, role=role)
            for user in (self.owner, self.mod, self.member, self.other):
                ConversationParticipant.objects.create(conversation=self.conversation, user=user)
            self.agent = AiAgent_Framework.objects.create(name='Voyages', created_by=self.member)
            self.auto = ConversationAgentSettings.objects.create(user=self.member, agent=self.agent, conversation=self.conversation, is_automatic=True)

        def request(self, view, actor, data=None, method='patch', **kwargs):
            request = getattr(APIRequestFactory(), method)('/', data=data or {}, format='json')
            force_authenticate(request, user=actor)
            return view(request, **kwargs)

        def member_action(self, actor, target, action, **extra):
            return self.request(GroupMemberDetailView.as_view(), actor, {'action': action, **extra}, group_uuid=self.group.uuid, user__uuid=target.uuid)

        def test_hierarchy_and_self_protection(self):
            for actor, target in ((self.member, self.mod), (self.mod, self.owner), (self.mod, self.other), (self.owner, self.owner), (self.outsider, self.member)):
                self.assertIn(self.member_action(actor, target, 'mute').status_code, (400, 403, 404))
            self.assertEqual(self.member_action(self.owner, self.mod, 'mute').status_code, 200)

        def test_only_owner_manages_roles(self):
            self.assertEqual(self.member_action(self.mod, self.member, 'promote').status_code, 400)
            self.assertEqual(self.member_action(self.owner, self.member, 'promote').status_code, 200)
            self.assertEqual(self.member_action(self.owner, self.member, 'demote').status_code, 200)
            self.assertEqual(list(GroupModerationLog.objects.values_list('action', flat=True))[:2], ['demote_moderator', 'promote_moderator'])

        def test_mute_blocks_writes_and_agents_and_expires(self):
            response = self.member_action(self.mod, self.member, 'mute', duration_hours=1)
            self.assertEqual(response.status_code, 200)
            with self.assertRaises(PermissionError): require_group_write(self.conversation, self.member)
            with self.assertRaises(PermissionError): require_group_agent(self.conversation, self.member, self.agent)
            require_group_write(self.conversation, self.other)
            membership = self.group.memberships.get(user=self.member)
            membership.muted_until = timezone.now() - timedelta(seconds=1)
            membership.save()
            require_group_write(self.conversation, self.member)
            require_group_agent(self.conversation, self.member, self.agent)
            self.assertFalse(self.group.memberships.get(user=self.member).is_muted)

        def test_muted_http_and_websocket_sends_are_refused(self):
            self.member_action(self.mod, self.member, 'mute')
            for view in send_views.values():
                response = self.request(view.as_view(), self.member, {'content':'Test'}, method='post', conversation_uuid=self.conversation.uuid)
                self.assertEqual(response.status_code, 403)
            socket = type('Socket', (), {'user': self.member})()
            self.assertIsNotNone(socket_permissions(socket, self.conversation))
            self.member_action(self.mod, self.member, 'unmute')
            self.assertIsNone(socket_permissions(socket, self.conversation))

        def test_agent_policy_is_rechecked_on_a_previously_loaded_conversation(self):
            # The same conversation instance is kept while an agent is generating.
            self.conversation.group
            self.request(GroupAIPolicyView.as_view(), self.owner, {'ai_agent_policy':'disabled'}, group_uuid=self.group.uuid)
            with self.assertRaises(PermissionError): require_group_agent(self.conversation, self.member, self.agent)

        def test_unmute_and_duration_validation(self):
            self.assertEqual(self.member_action(self.mod, self.member, 'mute').status_code, 200)
            self.assertEqual(self.member_action(self.mod, self.member, 'unmute').status_code, 200)
            require_group_write(self.conversation, self.member)
            for data in ({'action': 'mute', 'duration_hours': 0}, {'action': 'ban', 'duration_hours': 24}, {}, {'action':'invalid'}):
                self.assertEqual(self.request(GroupMemberDetailView.as_view(), self.owner, data, group_uuid=self.group.uuid, user__uuid=self.member.uuid).status_code, 400)

        def test_ban_removes_access_and_unban_does_not_rejoin(self):
            self.assertEqual(self.member_action(self.mod, self.member, 'ban', reason='Spam').status_code, 200)
            self.assertFalse(self.conversation.participants.filter(pk=self.member.pk).exists())
            self.auto.refresh_from_db()
            self.assertFalse(self.auto.is_automatic)
            with self.assertRaises(PermissionError): require_group_write(self.conversation, self.member)
            invitation = GroupInvitation.objects.create(group=self.group, target_user=self.member, created_by=self.owner, expires_at=timezone.now()+timedelta(days=1))
            from django.core.exceptions import ValidationError
            with self.assertRaises(ValidationError): invitation.accept()
            self.assertEqual(self.member_action(self.mod, self.member, 'unban').status_code, 200)
            with self.assertRaises(PermissionError): require_group_write(self.conversation, self.member)
            join = GroupCodeJoinSerializer(data={'invite_code': self.group.invite_code}, context={'request': type('Request', (), {'user': self.member})()})
            self.assertTrue(join.is_valid(), join.errors)

        def test_kick_removes_automatic_settings_and_participation(self):
            self.assertEqual(self.member_action(self.owner, self.member, 'kick').status_code, 200)
            self.assertFalse(self.group.memberships.filter(user=self.member).exists())
            self.assertFalse(self.conversation.participants.filter(pk=self.member.pk).exists())
            with self.assertRaises(PermissionError): require_group_agent(self.conversation, self.member, self.agent)

        def test_policy_and_individual_ai_block_are_enforced(self):
            response = self.request(GroupAIPolicyView.as_view(), self.owner, {'ai_agent_policy': 'disabled'}, group_uuid=self.group.uuid)
            self.assertEqual(response.status_code, 200)
            self.conversation.refresh_from_db()
            with self.assertRaises(PermissionError): require_group_agent(self.conversation, self.member, self.agent)
            self.request(GroupAIPolicyView.as_view(), self.owner, {'ai_agent_policy': 'admins_only'}, group_uuid=self.group.uuid)
            self.conversation.refresh_from_db()
            require_group_agent(self.conversation, self.mod, self.agent)
            with self.assertRaises(PermissionError): require_group_agent(self.conversation, self.member, self.agent)
            self.request(GroupAIPolicyView.as_view(), self.owner, {'ai_agent_policy': 'everyone'}, group_uuid=self.group.uuid)
            self.conversation.refresh_from_db()
            response = self.request(GroupMemberAIBlockView.as_view(), self.mod, {'action':'block', 'reason':'Abus'}, group_uuid=self.group.uuid, user_uuid=self.member.uuid)
            self.assertEqual(response.status_code, 200)
            with self.assertRaises(PermissionError): require_group_agent(self.conversation, self.member, self.agent)
            require_group_write(self.conversation, self.member)
            response = self.request(GroupMemberAIBlockView.as_view(), self.mod, {'action':'unblock'}, group_uuid=self.group.uuid, user_uuid=self.member.uuid)
            self.assertEqual(response.status_code, 200)
            require_group_agent(self.conversation, self.member, self.agent)

        def test_agent_suspend_is_group_wide_and_resuming_stays_manual(self):
            response = self.request(group_agent_moderation, self.mod, {'action':'block'}, group_uuid=self.group.uuid, agent_uuid=self.agent.uuid)
            self.assertEqual(response.status_code, 200)
            for user in (self.owner, self.mod, self.member):
                with self.assertRaises(PermissionError): require_group_agent(self.conversation, user, self.agent)
            self.auto.refresh_from_db()
            self.assertFalse(self.auto.is_automatic)
            response = self.request(group_agent_moderation, self.mod, {'action':'unblock'}, group_uuid=self.group.uuid, agent_uuid=self.agent.uuid)
            self.assertEqual(response.status_code, 200)
            require_group_agent(self.conversation, self.member, self.agent)
            self.auto.refresh_from_db()
            self.assertFalse(self.auto.is_automatic)

        def test_suspended_automatic_agent_does_not_even_create_a_thread(self):
            message = Message.objects.create(conversation=self.conversation,sender=self.other,content='Bonjour')
            message.parent_message = None
            initial_count = Message.objects.count()
            GroupAgentBlock.objects.create(group=self.group,agent=self.agent)
            AgentService.process_automatic_agents(message)
            self.assertEqual(Message.objects.count(), initial_count)
            GroupAgentBlock.objects.all().delete()
            self.request(GroupAIPolicyView.as_view(),self.owner,{'ai_agent_policy':'disabled'},group_uuid=self.group.uuid)
            AgentService.process_automatic_agents(message)
            self.assertEqual(Message.objects.count(), initial_count)

        def test_members_cannot_read_banned_list_or_modify_agents_policy(self):
            for actor in (self.member, self.outsider):
                self.assertIn(self.request(group_moderation, actor, method='get', group_uuid=self.group.uuid).status_code, (403,404))
                self.assertEqual(self.request(group_agent_moderation, actor, {'action':'block'}, group_uuid=self.group.uuid, agent_uuid=self.agent.uuid).status_code, 403)
                self.assertEqual(self.request(GroupAIPolicyView.as_view(), actor, {'ai_agent_policy':'disabled'}, group_uuid=self.group.uuid).status_code, 403)
            self.member_action(self.owner, self.mod, 'ban')
            self.assertEqual(self.request(group_moderation, self.mod, method='get', group_uuid=self.group.uuid).status_code,403)

        def test_summary_and_member_details_reflect_state(self):
            self.member_action(self.mod, self.member, 'ban', reason='Spam')
            response = self.request(group_moderation, self.owner, method='get', group_uuid=self.group.uuid)
            self.assertEqual(response.data['banned_members'][0]['ban_reason'], 'Spam')
            self.assertEqual(response.data['agents'][0]['name'], 'Voyages')
            detail = self.request(GroupDetailView.as_view(), self.owner, method='get', uuid=self.group.uuid)
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.data['ai_agent_policy'], 'everyone')
            self.assertEqual(len(detail.data['members']), 3)

    if '--serve' in sys.argv:
        import json
        import re
        from http.server import HTTPServer, BaseHTTPRequestHandler
        from groups.views import MyGroupsListView, GroupMembersListView, GroupModerationLogsView, group_stats
        scenario = ModerationTests()
        scenario.setUp()
        user = scenario.owner
        conv = scenario.conversation
        group = scenario.group
        def profile():
            return {'uuid': str(user.uuid), 'username': user.username, 'email':'preview@example.test', 'has_accepted_cgu': True,
                'ai_agents_enabled':True, 'ai_policy_version':1, 'preview_pinned_uuid':str(conv.uuid)}
        def conversation():
            return {'uuid':str(conv.uuid), 'conversation_type':'group_chat', 'name':group.name,
                'group_info':{'uuid':str(group.uuid), 'name':group.name}, 'group_uuid':str(group.uuid), 'unread_count':0, 'messages':[]}
        class PreviewHandler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def handle_request(self):
                path = self.path.split('?')[0]
                raw = self.rfile.read(int(self.headers.get('Content-Length',0)))
                data = json.loads(raw) if raw else {}
                result, status = [], 200
                if path == '/api/auth/profile/': result = profile()
                elif path == '/watches/': result = {'results':[], 'count':0, 'next_offset':None}
                elif path == '/watches/preferences/': result = {'images_enabled':False,'push_enabled':False,'daily_notification_limit':3,'quiet_hours_start':22,'quiet_hours_end':8,'timezone':'Europe/Paris'}
                elif path in ('/messaging/conversations/', '/messaging/conversations/groups/'): result = [conversation()]
                elif path == f'/messaging/conversations/{conv.uuid}/': result = conversation()
                elif '/messages/' in path: result = {'results':[], 'next':None}
                elif path.startswith('/groups/'):
                    from django.urls import resolve
                    try:
                        match = resolve(path.removeprefix('/groups'))
                        request = getattr(APIRequestFactory(),self.command.lower())(path, data=data, format='json')
                        force_authenticate(request,user=user)
                        response = match.func(request, **match.kwargs)
                        result, status = response.data, response.status_code
                    except Exception as exc:
                        result, status = {'detail':str(exc)}, 500
                body = json.dumps(result,ensure_ascii=False,default=str).encode()
                self.send_response(status)
                self.send_header('Content-Type','application/json; charset=utf-8')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            do_GET = do_POST = do_PATCH = handle_request
        port = int(sys.argv[sys.argv.index('--serve')+1])
        print(f'API modération de simulation prête sur 127.0.0.1:{port}',flush=True)
        HTTPServer(('127.0.0.1',port),PreviewHandler).serve_forever()

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ModerationTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
