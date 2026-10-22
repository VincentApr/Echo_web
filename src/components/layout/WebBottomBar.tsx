import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IoSend, IoAdd, IoMic, IoClose, IoImage, IoDocument, IoHardwareChip, IoCodeSlash, IoChevronBack, IoCheckmark, IoPlay } from 'react-icons/io5';
import { useQuery } from '@tanstack/react-query';
import { useJarvis } from '../../contexts/JarvisContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useWebSocketContext } from '../../contexts/WebSocketContext';
import { readComposer, saveDraft, beginSend, failSend, completeSend, subscribeComposer, type ComposerDraft } from '../../services/composerDrafts';
import { MessageDeliveryError } from '../../services/messageDelivery';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { enrichAgent, type BackendAgent, type ToolItem } from '../../data/toolsCatalog';
import aiWatermark from '@web/assets/logo-watermark.png?inline';
import { JARVIS_AGENT_UUID } from '@web/constants/jarvisAgent';
import { normalizeAgentCatalog } from '@web/utils/agentCatalog';
import './WebBottomBar.css';

const getFirstNonEmptyLine = (text?: string): string => {
    if (!text) return 'Message sans texte';
    const firstLine = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);

    if (!firstLine) return 'Message sans texte';
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
};

const DEFAULT_CODE_TEMPLATE = 'print("Hello from Echo")';

interface ScriptDetailResponse {
    uuid: string;
    title: string;
    description?: string;
    code_language: 'python';
    current_version?: { version_number: number } | null;
}

interface ScriptExecutionResponse {
    uuid: string;
    status: 'queued' | 'running' | 'success' | 'error' | 'timeout';
    stdout?: string;
    stderr?: string;
    exit_code?: number | null;
    duration_ms?: number | null;
}

function buildExecutableCode(code: string, inputParams: Record<string, unknown>) {
    const paramsLiteral = JSON.stringify(JSON.stringify(inputParams));
    return ['import json as __echo_json', `params = __echo_json.loads(${paramsLiteral})`, 'globals().update(params)', '', code].join('\n');
}

function buildCodeShareMessage(script: ScriptDetailResponse, execution: ScriptExecutionResponse | null, inputParams: Record<string, unknown>, code: string) {
    return JSON.stringify({
        kind: 'echo.code_share.v1',
        script: {
            uuid: script.uuid,
            title: script.title,
            description: script.description || '',
            language: script.code_language,
            version: script.current_version?.version_number || 1,
            code,
        },
        inputParams,
        execution: execution ? {
            uuid: execution.uuid,
            status: execution.status,
            stdout: execution.stdout || '',
            stderr: execution.stderr || '',
            exitCode: execution.exit_code ?? null,
            durationMs: execution.duration_ms ?? null,
        } : null,
    });
}

// ── Staged file preview item ───────────────────────────────────────────────
function StagedFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
    const isImage = file.type.startsWith('image/');
    const previewUrl = useMemo(() => isImage ? URL.createObjectURL(file) : null, [file, isImage]);

    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    return (
        <div className={`wbb-staged-chip ${isImage ? 'wbb-staged-chip--media' : ''}`}>
            {isImage && previewUrl ? (
                <img src={previewUrl} alt={file.name} className="wbb-staged-chip__thumb" />
            ) : (
                <div className="wbb-staged-chip__icon">📎</div>
            )}
            <span className="wbb-staged-chip__name">{file.name.length > 18 ? file.name.slice(0, 16) + '…' : file.name}</span>
            <button className="wbb-staged-chip__remove" onClick={onRemove} title="Retirer">
                <IoClose size={12} />
            </button>
        </div>
    );
}

function formatRecordingTime(seconds: number) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function SelectedAgentAvatar({ agent }: { agent: ToolItem }) {
    const [failed, setFailed] = useState(false);
    const initials = agent.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toUpperCase() || 'IA';
    return agent.avatarUrl && !failed
        ? <img src={agent.avatarUrl} alt="" className="wbb-selected-agent-avatar" onError={() => setFailed(true)} />
        : <span className="wbb-selected-agent-avatar wbb-selected-agent-avatar--fallback" aria-hidden="true">{initials}</span>;
}

function ToolPicker({
    tools,
    selectedTool,
    onSelect,
}: {
    tools: ToolItem[];
    selectedTool: ToolItem | null;
    onSelect: (tool: ToolItem) => void;
}) {
    return (
        <div className="wbb-tool-menu">
            <div className="wbb-tool-menu__title">Tools Jarvis</div>
            {tools.length === 0 ? (
                <div className="wbb-tool-menu__empty">Aucun tool disponible</div>
            ) : (
                tools.slice(0, 8).map((tool) => (
                    <button
                        key={tool.id}
                        type="button"
                        className={`wbb-tool-menu__item ${selectedTool?.id === tool.id ? 'wbb-tool-menu__item--selected' : ''}`}
                        onClick={() => onSelect(tool)}
                    >
                        <span className="wbb-tool-menu__icon"><IoHardwareChip size={18} /></span>
                        <span className="wbb-tool-menu__text">
                            <span className="wbb-tool-menu__name">{tool.name}</span>
                            <span className="wbb-tool-menu__desc">{tool.description}</span>
                        </span>
                    </button>
                ))
            )}
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function WebBottomBar() {
    const {
        sendJarvisMessage,
        composerText,
        composerFocusKey,
        setComposerText,
        upsertLiveTurn,
    } = useJarvis();
    const { selectedConversation, sendCallback, replyTo, setReplyTo } = useNavigation();
    const { user } = useAuth();
    const { isConnected, isOnline } = useWebSocketContext();
    const aiEnabled = user?.ai_agents_enabled !== false;
    const owner = user?.uuid || '';
    const conversation = selectedConversation?.uuid || '';
    const [saved] = useState(() => readComposer(owner, conversation));
    const [recoveries, setRecoveries] = useState(saved.sends);
    const [sendError, setSendError] = useState('');
    const mountedRef = useRef(true);

    const [text, setText] = useState(saved.draft.text);
    const [stagedFiles, setStagedFiles] = useState<File[]>([]);
    const [jarvisMode, setJarvisMode] = useState(saved.draft.jarvisMode);
    const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
    const [toolPickerOpen, setToolPickerOpen] = useState(false);
    const [selectedTool, setSelectedTool] = useState<ToolItem | null>(saved.draft.agent);
    const startingAgentThread = jarvisMode && !replyTo?.isAgentThread;
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [stagedVoice, setStagedVoice] = useState<{ file: File; url: string } | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [codeModalOpen, setCodeModalOpen] = useState(false);
    const [codeTitle, setCodeTitle] = useState('');
    const [codeDescription, setCodeDescription] = useState('');
    const [codeBody, setCodeBody] = useState(DEFAULT_CODE_TEMPLATE);
    const [codeInputParams, setCodeInputParams] = useState('{}');
    const [codeError, setCodeError] = useState('');
    const [isSubmittingCode, setIsSubmittingCode] = useState(false);

    const mediaInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const sendLockRef = useRef(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const recorderStreamRef = useRef<MediaStream | null>(null);
    const recorderChunksRef = useRef<Blob[]>([]);

    const isChat = !!selectedConversation;
    const effectiveText = isChat ? text : composerText;
    const canSend = effectiveText.trim().length > 0 || stagedFiles.length > 0 || !!stagedVoice;

    useEffect(() => {
        mountedRef.current = true;
        if (conversation && !replyTo && saved.draft.reply) setReplyTo(saved.draft.reply);
        const unsubscribe = subscribeComposer(() => setRecoveries(readComposer(owner, conversation).sends));
        return () => { mountedRef.current = false; unsubscribe(); };
    // The composer is keyed by account and conversation in AppLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!conversation) return;
        try { saveDraft(owner, conversation, { text, jarvisMode, agent: selectedTool, reply: replyTo }); }
        catch { setSendError('Le navigateur ne peut pas sauvegarder le brouillon. Garde cette page ouverte.'); }
    }, [owner, conversation, text, jarvisMode, selectedTool, replyTo]);

    useEffect(() => {
        if (!stagedFiles.length && !stagedVoice) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [stagedFiles.length, stagedVoice]);

    useEffect(() => {
        if (!aiEnabled) {
            setJarvisMode(false); setSelectedTool(null); setToolPickerOpen(false);
            if (replyTo?.isAgentThread) setReplyTo(null);
        }
    }, [aiEnabled, replyTo?.isAgentThread, setReplyTo]);

    const { data: tools = [] } = useQuery({
        queryKey: ['agents', 'favorites', 'bottom-bar'],
        queryFn: async (): Promise<ToolItem[]> => {
            const res = await fetchWithAuth(`${API_BASE_URL}/framework/agents/`);
            if (!res.ok) return [];
            const data = await res.json();
            const rawAgents = normalizeAgentCatalog<BackendAgent>(data);
            const unique = new Map<string, BackendAgent>();
            rawAgents.forEach((agent) => {
                if (agent.uuid) unique.set(agent.uuid, { ...unique.get(agent.uuid), ...agent });
            });
            return [...unique.values()].filter((agent) => agent.is_favorite).map(enrichAgent);
        },
        enabled: aiEnabled && isChat && (jarvisMode || toolPickerOpen),
        staleTime: 5 * 60_000,
    });

    useEffect(() => {
        if (!isChat && composerFocusKey > 0) textareaRef.current?.focus();
    }, [composerFocusKey, isChat]);

    useEffect(() => {
        if (!isRecording) return;
        const timer = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [isRecording]);

    useEffect(() => () => {
        recorderStreamRef.current?.getTracks().forEach(track => track.stop());
        if (stagedVoice) URL.revokeObjectURL(stagedVoice.url);
    }, [stagedVoice]);

    useEffect(() => {
        setAttachmentMenuOpen(false);
        setToolPickerOpen(false);
        setStagedFiles([]);
        if (stagedVoice) URL.revokeObjectURL(stagedVoice.url);
        setStagedVoice(null);
    // Reset transient composer modes when switching conversations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedConversation?.uuid]);

    useEffect(() => {
        if (!codeModalOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSubmittingCode) setCodeModalOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [codeModalOpen, isSubmittingCode]);

    const cancelStagedVoice = () => {
        if (stagedVoice) URL.revokeObjectURL(stagedVoice.url);
        setStagedVoice(null);
    };

    const startRecording = async () => {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
                .find(type => MediaRecorder.isTypeSupported(type));
            const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
            recorderStreamRef.current = stream;
            recorderRef.current = recorder;
            recorderChunksRef.current = [];
            recorder.ondataavailable = event => {
                if (event.data.size > 0) recorderChunksRef.current.push(event.data);
            };
            recorder.onstop = () => {
                const mime = recorder.mimeType || preferredType || 'audio/webm';
                const blob = new Blob(recorderChunksRef.current, { type: mime });
                const extension = mime.includes('mp4') ? 'm4a' : 'webm';
                const file = new File([blob], `voice_${Date.now()}.${extension}`, { type: mime });
                setStagedVoice({ file, url: URL.createObjectURL(blob) });
                stream.getTracks().forEach(track => track.stop());
                recorderStreamRef.current = null;
                recorderRef.current = null;
            };
            recorder.start();
            setRecordingSeconds(0);
            setAttachmentMenuOpen(false);
            setJarvisMode(false);
            setSelectedTool(null);
            setIsRecording(true);
        } catch (error) {
            console.warn('Microphone unavailable', error);
        }
    };

    const stopRecording = () => {
        if (!isRecording) return;
        recorderRef.current?.stop();
        setIsRecording(false);
    };

    const sendVoiceToJarvis = async (voice: File) => {
        const turnId = `jarvis-voice-${Date.now()}`;
        upsertLiveTurn({ id: turnId, inputType: 'voice', userMessage: '', jarvisResponse: '', isProcessing: true });
        const formData = new FormData();
        formData.append('audio', voice, voice.name);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/jarvis/vocal/`, { method: 'POST', body: formData });
            const data = await response.json().catch(() => ({}));
            upsertLiveTurn({
                id: turnId,
                inputType: 'voice',
                userMessage: data.transcription || '',
                jarvisResponse: response.ok ? (data.jarvis_response || data.response || 'Aucune réponse') : (data.detail || 'Impossible de traiter le vocal.'),
                isProcessing: false,
            });
        } catch {
            upsertLiveTurn({ id: turnId, inputType: 'voice', userMessage: '', jarvisResponse: 'Erreur réseau', isProcessing: false });
        }
    };

    const resetCodeComposer = () => {
        setCodeTitle('');
        setCodeDescription('');
        setCodeBody(DEFAULT_CODE_TEMPLATE);
        setCodeInputParams('{}');
        setCodeError('');
    };

    const pollScriptExecution = async (executionUuid: string): Promise<ScriptExecutionResponse> => {
        let lastExecution: ScriptExecutionResponse | null = null;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const response = await fetchWithAuth(`${API_BASE_URL}/scripts/executions/${executionUuid}/`);
            if (!response.ok) throw new Error("Impossible de suivre l’exécution du script.");
            const nextExecution = await response.json() as ScriptExecutionResponse;
            lastExecution = nextExecution;
            if (!['queued', 'running'].includes(nextExecution.status)) return nextExecution;
            await new Promise(resolve => window.setTimeout(resolve, 1200));
        }
        if (!lastExecution) throw new Error("L’exécution n’a pas démarré.");
        return lastExecution;
    };

    const handleSubmitCode = async () => {
        if (!selectedConversation || !sendCallback.current || isSubmittingCode) return;
        const title = codeTitle.trim();
        const code = codeBody.trim();
        if (!title || !code) return;

        let inputParams: Record<string, unknown>;
        try {
            const parsed: unknown = codeInputParams.trim() ? JSON.parse(codeInputParams) : {};
            if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
                setCodeError('Les paramètres doivent être un objet JSON.');
                return;
            }
            inputParams = parsed as Record<string, unknown>;
        } catch {
            setCodeError('JSON invalide. Corrige les paramètres avant de lancer le code.');
            return;
        }

        setCodeError('');
        setIsSubmittingCode(true);
        try {
            const createResponse = await fetchWithAuth(`${API_BASE_URL}/scripts/`, {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    description: codeDescription.trim(),
                    code_language: 'python',
                    visibility: 'friends',
                    code: buildExecutableCode(code, inputParams),
                }),
            });
            if (!createResponse.ok) {
                const errorPayload = await createResponse.json().catch(() => null) as Record<string, unknown> | null;
                const detail = errorPayload && (
                    typeof errorPayload.detail === 'string' ? errorPayload.detail
                        : typeof errorPayload.error === 'string' ? errorPayload.error
                            : null
                );
                throw new Error(detail || `Impossible de créer le script (erreur ${createResponse.status}).`);
            }
            const script: ScriptDetailResponse = await createResponse.json();
            let execution: ScriptExecutionResponse | null = null;
            try {
                const executeResponse = await fetchWithAuth(`${API_BASE_URL}/scripts/${script.uuid}/execute/`, {
                    method: 'POST',
                    body: JSON.stringify({ input_params: inputParams }),
                });
                if (executeResponse.ok) {
                    const queuedExecution: ScriptExecutionResponse = await executeResponse.json();
                    execution = await pollScriptExecution(queuedExecution.uuid);
                }
            } catch (error) {
                console.warn('Script execution unavailable', error);
            }
            await sendCallback.current.sendText(
                buildCodeShareMessage(script, execution, inputParams, code),
                replyTo?.uuid ?? null,
            );
            setReplyTo(null);
            setCodeModalOpen(false);
            resetCodeComposer();
        } catch (error) {
            setCodeError(error instanceof Error ? error.message : 'Impossible de partager ce code.');
        } finally {
            setIsSubmittingCode(false);
        }
    };

    const handleSend = async () => {
        if (!canSend) return;
        if (!aiEnabled && (!isChat || jarvisMode || replyTo?.isAgentThread || selectedConversation?.conversation_type === 'agent')) {
            setSendError('Les fonctionnalités IA sont désactivées dans vos paramètres.');
            return;
        }
        if (sendLockRef.current) return;
        sendLockRef.current = true;
        setIsSending(true);
        setSendError('');
        const submissionId = `temp-${crypto.randomUUID()}`;
        const submittedDraft: ComposerDraft = { text: effectiveText, jarvisMode, agent: selectedTool, reply: replyTo };
        if (isChat) {
            if (!sendCallback.current) {
                setSendError('La conversation est en cours de chargement. Réessaie dans un instant.');
                sendLockRef.current = false; setIsSending(false); return;
            }
            try {
                beginSend(owner, conversation, { id: submissionId, draft: submittedDraft,
                    fileNames: [...stagedFiles, ...(stagedVoice ? [stagedVoice.file] : [])].map(file => file.name), status: 'pending' });
            } catch {
                setSendError('Impossible de sauvegarder le message avant l’envoi. Libère de l’espace dans le navigateur puis réessaie.');
                sendLockRef.current = false; setIsSending(false); return;
            }
        }

        // This invocation retains the submitted values in its closure. Reset
        // the composer immediately, without later erasing the next draft.
        if (isChat) setText('');
        else setComposerText('');
        setJarvisMode(false);
        setReplyTo(null);
        setSelectedTool(null);
        setAttachmentMenuOpen(false);
        setToolPickerOpen(false);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';

        try {
        if (stagedVoice && !isChat) {
            await sendVoiceToJarvis(stagedVoice.file);
        } else if (isChat && sendCallback.current) {
            const inAgentThread = !!replyTo?.isAgentThread;
            const targetAgentUuid = inAgentThread ? replyTo?.aiAgentUuid || null : jarvisMode ? (selectedTool?.agentUuid || JARVIS_AGENT_UUID) : null;
            const filesToSend = stagedVoice ? [...stagedFiles, stagedVoice.file] : stagedFiles;
            const result = filesToSend.length > 0
                ? await sendCallback.current.sendFiles(effectiveText.trim(), filesToSend, replyTo?.uuid ?? null, targetAgentUuid, inAgentThread, submissionId)
                : await sendCallback.current.sendText(effectiveText.trim(), replyTo?.uuid ?? null, targetAgentUuid, inAgentThread, submissionId);
            // Socket submission is only acknowledged when its echo is persisted.
            if (!(result && typeof result === 'object' && 'tempUuid' in result)) completeSend(owner, conversation, submissionId);
        } else if (!isChat) {
            if (effectiveText.trim()) await sendJarvisMessage(effectiveText.trim());
        }

        if (mountedRef.current) {
            setStagedFiles(current => current.filter(file => !stagedFiles.includes(file)));
            cancelStagedVoice();
        }

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Impossible d’envoyer le message.';
            if (isChat) {
                try {
                    if (error instanceof MessageDeliveryError && error.delivery === 'sent') completeSend(owner, conversation, submissionId);
                    else failSend(owner, conversation, submissionId, message, error instanceof MessageDeliveryError && error.delivery === 'uncertain');
                } catch { /* The in-memory UI still displays the failure. */ }
            }
            if (mountedRef.current) setSendError(message);
        } finally {
        window.setTimeout(() => {
            sendLockRef.current = false;
            if (mountedRef.current) setIsSending(false);
        }, 450);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (isChat) setText(e.target.value);
        else setComposerText(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 242) + 'px';
    };

    const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setStagedFiles(prev => [...prev, ...files]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeFile = (index: number) => {
        setStagedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const selectTool = (tool: ToolItem) => {
        if (replyTo?.isAgentThread) setReplyTo(null);
        setSelectedTool(tool);
        setJarvisMode(true);
        setToolPickerOpen(false);
        setAttachmentMenuOpen(false);
        textareaRef.current?.focus();
    };

    if (!aiEnabled && (!isChat || selectedConversation?.conversation_type === 'agent')) return null;

    return (
        <footer className={`web-bottom-bar ${isChat ? 'web-bottom-bar--chat' : 'web-bottom-bar--jarvis'}`}>

            <div className="web-bottom-bar__inner">
                {attachmentMenuOpen && !isRecording && stagedFiles.length === 0 && !stagedVoice && (
                    <div className="wbb-attachment-tray">
                        {toolPickerOpen ? (
                            <div className="wbb-agent-tray">
                                <div className="wbb-agent-tray__header">
                                    <button type="button" className="wbb-tray-round-btn" onClick={() => setToolPickerOpen(false)}><IoChevronBack size={20} /></button>
                                    <strong>Agents</strong>
                                    <span className="wbb-tray-round-btn wbb-tray-round-btn--spacer" />
                                </div>
                                <ToolPicker tools={tools} selectedTool={selectedTool} onSelect={selectTool} />
                            </div>
                        ) : (
                            <div className="wbb-attachment-options">
                                <button type="button" className="wbb-attachment-option" onClick={() => mediaInputRef.current?.click()}>
                                    <span className="wbb-attachment-option__icon wbb-attachment-option__icon--photo"><IoImage size={20} /></span>
                                    <span>Photo / Vidéo</span>
                                </button>
                                <button type="button" className="wbb-attachment-option" onClick={() => fileInputRef.current?.click()}>
                                    <span className="wbb-attachment-option__icon wbb-attachment-option__icon--file"><IoDocument size={20} /></span>
                                    <span>Fichier</span>
                                </button>
                                {aiEnabled && <button type="button" className="wbb-attachment-option" onClick={() => setToolPickerOpen(true)} disabled={!isChat || !aiEnabled}>
                                    <span className="wbb-attachment-option__icon wbb-attachment-option__icon--agent"><IoHardwareChip size={20} /></span>
                                    <span>Agents</span>
                                </button>}
                                <button type="button" className="wbb-attachment-option" disabled={!isChat} onClick={() => {
                                    setAttachmentMenuOpen(false);
                                    setCodeError('');
                                    setCodeModalOpen(true);
                                }}>
                                    <span className="wbb-attachment-option__icon wbb-attachment-option__icon--code"><IoCodeSlash size={20} /></span>
                                    <span>Code</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {isChat && (!isOnline || !isConnected) && <div className="wbb-delivery-notice" role="status">
                    {!isOnline ? 'Hors connexion · les brouillons sont conservés' : 'Reconnexion du temps réel…'}
                </div>}
                {sendError && <div className="wbb-delivery-notice wbb-delivery-notice--error" role="alert">{sendError}</div>}
                {isChat && recoveries.map(send => <div className="wbb-delivery-notice" key={send.id}>
                    <span>{send.status === 'failed' ? 'Message non envoyé.' : isSending ? 'Envoi en cours…' : 'Envoi non confirmé : vérifie la conversation avant de le renvoyer.'}
                        {send.fileNames.length > 0 && ` Fichiers à vérifier ou joindre à nouveau : ${send.fileNames.join(', ')}.`}</span>
                    <button type="button" disabled={!!text.trim() || isSending} onClick={() => {
                        try {
                            saveDraft(owner, conversation, send.draft);
                            setText(send.draft.text); setJarvisMode(send.draft.jarvisMode);
                            setSelectedTool(send.draft.agent); setReplyTo(send.draft.reply);
                            completeSend(owner, conversation, send.id); setSendError('');
                            textareaRef.current?.focus();
                        } catch { setSendError('Impossible de récupérer le brouillon.'); }
                    }}>Reprendre dans la saisie</button>
                    <button type="button" disabled={isSending} onClick={() => {
                        try { completeSend(owner, conversation, send.id); } catch { setSendError('Impossible de masquer cet envoi.'); }
                    }}>Masquer</button>
                </div>)}

                {/* Reply / new agent thread preview */}
                {isChat && (replyTo || startingAgentThread) && (
                    <div className="wbb-reply-preview">
                        <div className="wbb-reply-preview__text">
                            <span className="wbb-reply-preview__sender">
                                {startingAgentThread
                                    ? `Commencer un thread avec ${selectedTool?.name || 'Jarvis'}`
                                    : replyTo?.isAgentThread ? 'Réponse dans le thread IA' : `Réponse à ${replyTo?.sender_username || 'message'}`}
                            </span>
                            {!startingAgentThread && replyTo && <span className="wbb-reply-preview__content">
                                {replyTo.isAgentThread
                                    ? "Ton prochain message sera envoyé à l’agent dans ce panel"
                                    : replyTo.attachments?.length ? '📎 Pièce jointe' : getFirstNonEmptyLine(replyTo.content)}
                            </span>}
                        </div>
                        <button
                            type="button"
                            className="wbb-reply-preview__close"
                            onClick={() => {
                                if (startingAgentThread) {
                                    setJarvisMode(false);
                                    setSelectedTool(null);
                                } else setReplyTo(null);
                            }}
                            aria-label={startingAgentThread ? 'Annuler le nouveau thread' : 'Annuler la réponse'}
                        >
                            <IoClose size={14} />
                        </button>
                    </div>
                )}

                {/* Staged files row */}
                {stagedFiles.length > 0 && (
                    <div className="wbb-staged-row">
                        {stagedFiles.map((f, i) => (
                            <StagedFileChip key={i} file={f} onRemove={() => removeFile(i)} />
                        ))}
                    </div>
                )}

                {stagedVoice && (
                    <div className="wbb-staged-voice">
                        <button type="button" className="wbb-icon-btn" onClick={cancelStagedVoice} aria-label="Supprimer le vocal"><IoClose size={18} /></button>
                        <audio src={stagedVoice.url} controls preload="metadata" />
                        <button type="button" className="web-bottom-bar__send web-bottom-bar__send--active" onClick={() => void handleSend()} disabled={isSending}>
                            <IoSend size={22} />
                        </button>
                    </div>
                )}

                {/* Main input row */}
                {!stagedVoice && <div className="web-bottom-bar__row">
                    {isRecording ? (
                        <>
                            <div className="wbb-recorder">
                                <span className="wbb-recorder__dot" />
                                <span className="wbb-recorder__time">{formatRecordingTime(recordingSeconds)}</span>
                                <span className="wbb-recorder__wave" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</span>
                            </div>
                            <button type="button" className="wbb-icon-btn" onClick={stopRecording} aria-label="Terminer l’enregistrement"><IoCheckmark size={24} /></button>
                        </>
                    ) : <>
                    {/* Mobile-style leading action. Attachments are currently sent in chats. */}
                    <button
                        className={`wbb-icon-btn ${attachmentMenuOpen ? 'wbb-icon-btn--active' : ''}`}
                        title="Ajouter"
                        onClick={() => {
                            if (stagedFiles.length > 0) setStagedFiles([]);
                            else {
                                setAttachmentMenuOpen(value => !value);
                                setToolPickerOpen(false);
                            }
                        }}
                    >
                        {stagedFiles.length > 0 ? <IoClose size={20} /> : <IoAdd size={20} />}
                    </button>
                    <input ref={mediaInputRef} type="file" multiple accept="image/*,video/*" hidden onChange={(event) => { handleFilePick(event); setAttachmentMenuOpen(false); setJarvisMode(false); }} />
                    <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { handleFilePick(event); setAttachmentMenuOpen(false); setJarvisMode(false); }} />

                    {/* Jarvis/thread mode button */}
                    {isChat && aiEnabled && (
                        <>
                            <button
                                type="button"
                                className={`wbb-icon-btn ${jarvisMode ? 'wbb-icon-btn--active' : ''}`}
                                title={selectedTool && jarvisMode ? `Annuler la sélection de ${selectedTool.name}` : jarvisMode ? 'Désactiver Jarvis' : 'Parler à Jarvis dans ce fil'}
                                aria-label={selectedTool && jarvisMode ? `Annuler la sélection de ${selectedTool.name}` : jarvisMode ? 'Désactiver Jarvis' : 'Parler à Jarvis dans ce fil'}
                                aria-pressed={jarvisMode}
                                onClick={() => {
                                    setAttachmentMenuOpen(false);
                                    setToolPickerOpen(false);
                                    if (replyTo?.isAgentThread) setReplyTo(null);
                                    setJarvisMode(value => selectedTool ? false : !value);
                                    setSelectedTool(null);
                                }}
                            >
                                {selectedTool && jarvisMode ? <SelectedAgentAvatar key={`${selectedTool.id}:${selectedTool.avatarUrl || ''}`} agent={selectedTool} /> : <img
                                    src={aiWatermark}
                                    alt=""
                                    className="wbb-ai-watermark"
                                />}
                            </button>
                        </>
                    )}

                    {/* Input */}
                    <div className="web-bottom-bar__input-wrap">
                        <textarea
                            ref={textareaRef}
                            className="web-bottom-bar__input"
                            rows={1}
                            placeholder={isChat
                                ? replyTo?.isAgentThread
                                    ? 'Répondre dans le thread IA'
                                    : jarvisMode
                                    ? `Parler à ${selectedTool?.name || 'Jarvis'}`
                                    : `Message pour ${selectedConversation.name || 'Conversation'}`
                                : 'Parler à Jarvis'}
                            value={effectiveText}
                            onChange={handleTextChange}
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            className={`web-bottom-bar__send ${canSend ? 'web-bottom-bar__send--active' : ''}`}
                            onClick={() => canSend ? void handleSend() : void startRecording()}
                            disabled={isSending}
                            aria-label={canSend ? 'Envoyer' : 'Message vocal'}
                        >
                            {canSend ? <IoSend size={24} /> : <IoMic size={24} />}
                        </button>
                    </div>
                    </>}
                </div>}
            </div>

            {codeModalOpen && (
                <div className="wbb-code-overlay" onMouseDown={() => !isSubmittingCode && setCodeModalOpen(false)}>
                    <section className="wbb-code-modal" role="dialog" aria-modal="true" aria-labelledby="wbb-code-title" onMouseDown={event => event.stopPropagation()}>
                        <header className="wbb-code-modal__header">
                            <div className="wbb-code-modal__heading">
                                <span className="wbb-code-modal__icon"><IoCodeSlash size={20} /></span>
                                <span>
                                    <strong id="wbb-code-title">Partager du code</strong>
                                    <small>Python · sandbox backend</small>
                                </span>
                            </div>
                            <button type="button" className="wbb-code-modal__close" onClick={() => setCodeModalOpen(false)} disabled={isSubmittingCode} aria-label="Fermer"><IoClose size={22} /></button>
                        </header>

                        <div className="wbb-code-modal__fields">
                            <label>
                                <span>Titre</span>
                                <input value={codeTitle} onChange={event => setCodeTitle(event.target.value)} placeholder="Titre" maxLength={120} disabled={isSubmittingCode} autoFocus />
                            </label>
                            <label>
                                <span>Description</span>
                                <textarea className="wbb-code-modal__description" value={codeDescription} onChange={event => setCodeDescription(event.target.value)} placeholder="Description" maxLength={400} disabled={isSubmittingCode} />
                            </label>
                            <label>
                                <span>Code Python</span>
                                <textarea className="wbb-code-modal__editor" value={codeBody} onChange={event => setCodeBody(event.target.value)} placeholder="print('Hello from Echo')" spellCheck={false} disabled={isSubmittingCode} />
                            </label>
                            <label>
                                <span>Paramètres modifiables</span>
                                <textarea className="wbb-code-modal__params" value={codeInputParams} onChange={event => setCodeInputParams(event.target.value)} placeholder='{"n": 10}' spellCheck={false} disabled={isSubmittingCode} />
                            </label>
                            {codeError && <div className="wbb-code-modal__error" role="alert">{codeError}</div>}
                        </div>

                        <footer className="wbb-code-modal__actions">
                            <button type="button" className="wbb-code-modal__cancel" onClick={() => setCodeModalOpen(false)} disabled={isSubmittingCode}>Annuler</button>
                            <button type="button" className="wbb-code-modal__submit" onClick={() => void handleSubmitCode()} disabled={isSubmittingCode || !codeTitle.trim() || !codeBody.trim()}>
                                {isSubmittingCode ? <span className="wbb-code-modal__spinner" /> : <IoPlay size={18} />}
                                {isSubmittingCode ? 'Exécution…' : 'Lancer et partager'}
                            </button>
                        </footer>
                    </section>
                </div>
            )}
        </footer>
    );
}
