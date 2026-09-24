import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { IoCheckmark, IoCheckmarkDone, IoChevronDown, IoChevronUp, IoDocumentTextOutline, IoPause, IoPlay, IoTimeOutline, IoWarningOutline } from 'react-icons/io5';
import type { Message, InteractiveMessageData, FormField } from '../../hooks/useMessages';
import { useAuth } from '../../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { MessageContextMenu } from './MessageContextMenu';
import { isFailedAssetUrl, markFailedAssetUrl } from '../../utils/failedAssetUrls';
import { isSystemMessage } from '../../utils/messageHelpers';
import { renderFormattedText } from './richText';
import './MessageBubble.css';

export const USER_COLORS = [
    '#e53935', // Red
    '#d81b60', // Pink
    '#8e24aa', // Purple
    '#5e35b1', // Deep Purple
    '#3949ab', // Indigo
    '#1e88e5', // Blue
    '#00897b', // Teal
    '#2e7d32', // Green
    '#ef6c00', // Orange
    '#d84315', // Deep Orange
    '#6d4c41', // Brown
    '#546e7a', // Blue Grey
    '#006064', // Dark Cyan
    '#33691e', // Dark Green
    '#b71c1c', // Dark Red
    '#1a237e'  // Dark Indigo
];

export const getUserColor = (username?: string | null, uuid?: string | null) => {
    const seed = uuid || username || "default";
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    // Mix to improve distribution
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    
    return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
};

const getFirstNonEmptyLine = (text?: string): string => {
    if (!text) return 'Message sans texte';
    const firstLine = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);

    if (!firstLine) return 'Message sans texte';
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
};

interface MessageBubbleProps {
    message: Message;
    isFirstInGroup: boolean;
    isLastInGroup: boolean;
    isSameSenderAsNext: boolean;
    isSameSenderAsPrev: boolean;
    isGroupConversation?: boolean;
    reactionEmojis?: string[];
    replyParent?: Message | null;
    replyAncestry?: Message[];
    replySiblingMessages?: Message[];
    isReplyExpanded?: boolean;
    senderColor?: string;
    onToggleReplyExpanded?: (messageUuid: string) => void;
    onReact?: (messageUuid: string, emoji: string) => void;
    onReply?: (message: Message) => void;
}

interface ConversationParticipantDetail {
    username: string;
    surnom?: string;
    user_uuid?: string;
    last_seen?: string | null;
}

interface MessageInfoEntry {
    userUuid: string;
    label: string;
    seenAt: string;
}

// ── Audio player ─────────────────────────────────────────────────────────────
function AudioAttachment({ url, isMe, durationHint }: { url: string; isMe: boolean; durationHint?: number }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [duration, setDuration] = useState(durationHint || 0);
    const [position, setPosition] = useState(0);

    useEffect(() => {
        setIsPlaying(false);
        setIsLoading(true);
        setDuration(durationHint || 0);
        setPosition(0);
    }, [url, durationHint]);

    const togglePlayback = async () => {
        const audio = audioRef.current;
        if (!audio || isLoading) return;
        if (!audio.paused) {
            audio.pause();
            return;
        }
        if (audio.duration > 0 && audio.currentTime >= audio.duration) audio.currentTime = 0;
        await audio.play().catch(() => setIsPlaying(false));
    };

    const formatTime = (seconds: number) => {
        const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
        return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
    };

    const seekToPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const audio = audioRef.current;
        if (!audio || duration <= 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        const nextPosition = ratio * duration;
        audio.currentTime = nextPosition;
        setPosition(nextPosition);
    };

    const resolveMediaDuration = (audio: HTMLAudioElement) => {
        if (Number.isFinite(audio.duration)) {
            setDuration(audio.duration);
            return;
        }

        // MediaRecorder WebM files may expose Infinity until the browser seeks
        // once. This makes their real duration available without starting audio.
        const restoreStart = () => {
            audio.removeEventListener('timeupdate', restoreStart);
            if (Number.isFinite(audio.duration)) setDuration(audio.duration);
            audio.currentTime = 0;
            setPosition(0);
        };
        audio.addEventListener('timeupdate', restoreStart);
        audio.currentTime = Number.MAX_SAFE_INTEGER;
    };

    const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

    return (
        <div className={`attachment-audio ${isMe ? 'attachment-audio--mine' : 'attachment-audio--theirs'}`}>
            <audio
                ref={audioRef}
                src={url}
                preload="metadata"
                onLoadedMetadata={(event) => {
                    resolveMediaDuration(event.currentTarget);
                    setIsLoading(false);
                }}
                onDurationChange={(event) => {
                    if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
                }}
                onCanPlay={() => setIsLoading(false)}
                onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
            />
            <button
                type="button"
                className="attachment-audio__play"
                onClick={(event) => {
                    event.stopPropagation();
                    void togglePlayback();
                }}
                disabled={isLoading || !url}
                aria-label={isPlaying ? 'Mettre le vocal en pause' : 'Écouter le vocal'}
            >
                {isLoading ? <span className="attachment-audio__loader" /> : isPlaying ? <IoPause size={18} /> : <IoPlay size={18} />}
            </button>
            <div className="attachment-audio__body">
                <button
                    className="attachment-audio__progress"
                    type="button"
                    onPointerDown={seekToPointer}
                    aria-label={`Position dans le message vocal : ${formatTime(position)} sur ${formatTime(duration)}`}
                >
                    <span className="attachment-audio__progress-fill" style={{ width: `${progress * 100}%` }} />
                    <span className="attachment-audio__progress-thumb" style={{ left: `${progress * 100}%` }} />
                </button>
                <span className="attachment-audio__time">
                    {formatTime(position)} / {formatTime(duration)}
                </span>
            </div>
        </div>
    );
}

// ── Video player ─────────────────────────────────────────────────────────────
function VideoAttachment({ url, thumbnailUrl }: { url: string; thumbnailUrl?: string }) {
    return (
        <div className="attachment-video">
            <video
                controls
                preload="none"
                poster={thumbnailUrl}
                style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8 }}
            >
                <source src={url} />
            </video>
        </div>
    );
}

function buildAttachmentKey(messageUuid: string, attachment: NonNullable<Message['attachments']>[number], index: number): string {
    return `${messageUuid}-${attachment.uuid || attachment.file_url || attachment.thumbnail_url || attachment.original_filename || 'attachment'}-${index}`;
}

type MessageAttachment = NonNullable<Message['attachments']>[number];
type RawMessageAttachment = MessageAttachment & {
    type?: string;
    content_type?: string;
    mime_type?: string;
    mime?: string;
    url?: string;
    download_url?: string;
    file?: string;
    preview_url?: string;
    thumbnail?: string;
    file_name?: string;
    filename?: string;
    name?: string;
};

function getAttachmentUrl(attachment: MessageAttachment): string {
    const raw = attachment as RawMessageAttachment;
    return attachment.file_url || raw.url || raw.download_url || raw.file || '';
}

function getAttachmentThumbnailUrl(attachment: MessageAttachment): string {
    const raw = attachment as RawMessageAttachment;
    return attachment.thumbnail_url || raw.thumbnail || raw.preview_url || '';
}

function getAttachmentName(attachment: MessageAttachment): string {
    const raw = attachment as RawMessageAttachment;
    const explicitName = attachment.original_filename || raw.file_name || raw.filename || raw.name;
    if (explicitName) return explicitName;
    const url = getAttachmentUrl(attachment);
    try {
        const pathname = new URL(url, window.location.origin).pathname;
        const candidate = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
        return candidate && candidate.includes('.') ? candidate : 'Fichier';
    } catch {
        return 'Fichier';
    }
}

function getAttachmentRawType(attachment: MessageAttachment): string {
    const raw = attachment as RawMessageAttachment;
    return String(attachment.file_type || raw.type || raw.content_type || raw.mime_type || raw.mime || '').toLowerCase();
}

function getAttachmentKind(attachment: MessageAttachment): 'image' | 'video' | 'audio' | 'document' {
    const rawType = getAttachmentRawType(attachment);
    const attachmentName = getAttachmentName(attachment).toLowerCase();
    const fileIdentity = `${attachmentName} ${getAttachmentUrl(attachment)}`
        .split(/[?#]/, 1)[0]
        .toLowerCase();

    // Web recordings commonly use an audio/webm container. Some backends infer
    // "video" from the ambiguous .webm extension, so voice metadata wins first.
    if (rawType.includes('audio') || rawType.includes('voice') || /^voice[_-]/i.test(attachmentName)) return 'audio';
    if (rawType.includes('video')) return 'video';
    if (/\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(fileIdentity)) return 'audio';
    if (/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(fileIdentity)) return 'video';
    if (
        rawType.includes('image') ||
        rawType.includes('photo') ||
        /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i.test(fileIdentity) ||
        (!!getAttachmentThumbnailUrl(attachment) && !rawType.includes('document') && !rawType.includes('pdf'))
    ) return 'image';
    return 'document';
}

function resolveAttachmentImageUrl(attachment: NonNullable<Message['attachments']>[number]): string {
    const thumbnailUrl = getAttachmentThumbnailUrl(attachment);
    const fileUrl = getAttachmentUrl(attachment);

    if (thumbnailUrl && !isFailedAssetUrl(thumbnailUrl)) {
        return thumbnailUrl;
    }

    if (fileUrl && !isFailedAssetUrl(fileUrl)) {
        return fileUrl;
    }

    return '';
}

function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
    const initialImageUrl = resolveAttachmentImageUrl(attachment);
    if (!initialImageUrl) {
        return (
            <a href={getAttachmentUrl(attachment)} target="_blank" rel="noopener noreferrer" className="attachment-file">
                📎 {getAttachmentName(attachment)}
            </a>
        );
    }

    return (
        <img
            src={initialImageUrl}
            alt="Image"
            className="attachment-image"
            onError={(event) => {
                const image = event.currentTarget;
                markFailedAssetUrl(image.currentSrc || image.src);

                if (
                    getAttachmentThumbnailUrl(attachment) &&
                    image.currentSrc !== getAttachmentUrl(attachment) &&
                    image.src !== getAttachmentUrl(attachment) &&
                    getAttachmentUrl(attachment) &&
                    !isFailedAssetUrl(getAttachmentUrl(attachment))
                ) {
                    image.src = getAttachmentUrl(attachment);
                    return;
                }

                image.style.display = 'none';
            }}
            onClick={() => window.open(getAttachmentUrl(attachment), '_blank')}
            style={{ cursor: 'pointer' }}
        />
    );
}

function ImageAttachmentGrid({ attachments, messageUuid }: { attachments: MessageAttachment[]; messageUuid: string }) {
    const visibleImages = attachments.slice(0, 4);
    const remainingCount = Math.max(0, attachments.length - visibleImages.length);

    return (
        <div className={`attachment-image-grid attachment-image-grid--${visibleImages.length}`}>
            {visibleImages.map((attachment, index) => {
                const imageUrl = resolveAttachmentImageUrl(attachment);
                return (
                    <button
                        type="button"
                        key={buildAttachmentKey(messageUuid, attachment, index)}
                        className={`attachment-image-grid__cell attachment-image-grid__cell--${index + 1}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            window.open(getAttachmentUrl(attachment), '_blank');
                        }}
                        aria-label={`Ouvrir la photo ${index + 1}`}
                    >
                        {imageUrl ? <img src={imageUrl} alt="" className="attachment-image-grid__photo" /> : <span>📎</span>}
                        {index === 3 && remainingCount > 0 && (
                            <span className="attachment-image-grid__more">+{remainingCount}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function FileAttachment({ attachment }: { attachment: MessageAttachment }) {
    const fileUrl = getAttachmentUrl(attachment);
    const fileName = getAttachmentName(attachment);
    const [preview, setPreview] = useState<string | null>(null);
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const isTextFile = ['txt', 'md', 'json', 'csv', 'log', 'js', 'ts', 'jsx', 'tsx', 'html', 'xml', 'css'].includes(extension);

    useEffect(() => {
        if (!isTextFile || !fileUrl) return;
        const controller = new AbortController();
        void fetch(fileUrl, { headers: { Range: 'bytes=0-1000' }, signal: controller.signal })
            .then(response => response.ok ? response.text() : '')
            .then(text => {
                const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
                if (cleanText) setPreview(`${cleanText.slice(0, 150)}${cleanText.length > 150 ? '…' : ''}`);
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [fileUrl, isTextFile]);

    return (
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="attachment-file-card">
            <span className="attachment-file-card__row">
                <span className="attachment-file-card__icon"><IoDocumentTextOutline size={24} /></span>
                <span className="attachment-file-card__name">{fileName}</span>
            </span>
            {preview && <span className="attachment-file-card__preview">{preview}</span>}
        </a>
    );
}

function AdaptiveFileAttachment({ attachment }: { attachment: MessageAttachment }) {
    const candidateUrl = resolveAttachmentImageUrl(attachment) || getAttachmentUrl(attachment);
    const [isImage, setIsImage] = useState<boolean | null>(null);

    useEffect(() => {
        if (!candidateUrl) {
            setIsImage(false);
            return;
        }
        let active = true;
        const probe = new Image();
        probe.onload = () => { if (active) setIsImage(true); };
        probe.onerror = () => { if (active) setIsImage(false); };
        probe.src = candidateUrl;
        return () => { active = false; };
    }, [candidateUrl]);

    if (isImage) return <ImageAttachment attachment={attachment} />;
    return <FileAttachment attachment={attachment} />;
}

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s]+)/i;

function WebLinkPreview({ content }: { content: string }) {
    const rawUrl = useMemo(() => content.match(URL_PATTERN)?.[1]?.replace(/[),.;!?]+$/, '') || '', [content]);
    const href = rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;
    const [metadata, setMetadata] = useState<{ title?: string; description?: string; image?: string } | null>(null);
    const host = useMemo(() => {
        try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return ''; }
    }, [href]);

    useEffect(() => {
        if (!href) return;
        const controller = new AbortController();
        void fetch(href, { signal: controller.signal })
            .then(response => response.ok ? response.text() : '')
            .then(html => {
                if (!html) return;
                const documentNode = new DOMParser().parseFromString(html, 'text/html');
                const value = (property: string) => documentNode.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute('content') || undefined;
                const image = value('og:image');
                setMetadata({
                    title: value('og:title') || documentNode.title || undefined,
                    description: value('og:description') || value('description'),
                    image: image ? new URL(image, href).href : undefined,
                });
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [href]);

    if (!href) return null;
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="message-link-preview" onClick={event => event.stopPropagation()}>
            {metadata?.image && <img src={metadata.image} alt="" className="message-link-preview__image" />}
            <span className="message-link-preview__body">
                <span className="message-link-preview__host">{host}</span>
                <span className="message-link-preview__title">{metadata?.title || rawUrl}</span>
                {metadata?.description && <span className="message-link-preview__description">{metadata.description}</span>}
            </span>
        </a>
    );
}

// ── Interactive message form ──────────────────────────────────────────────────
function InteractiveForm({ data, messageUuid, isMe }: {
    data: InteractiveMessageData;
    messageUuid: string;
    isMe: boolean;
}) {
    const [values, setValues] = useState<Record<string, string | boolean>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    if (!data.form_data) return null;

    const { fields, responses } = data.form_data;
    const canSubmit = data.can_submit !== false && !submitted;

    const handleSubmit = async () => {
        if (submitting || !canSubmit) return;
        setSubmitting(true);
        try {
            await fetchWithAuth(`${API_BASE_URL}/messaging/messages/${messageUuid}/interact/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ responses: values }),
            });
            setSubmitted(true);
        } catch {
            // Silently fail
        } finally {
            setSubmitting(false);
        }
    };

    const renderField = (field: FormField) => {
        const existingResponse = responses[field.id];
        if (existingResponse) {
            return (
                <div key={field.id} className="iform-field">
                    <label className="iform-label">{field.label}</label>
                    <div className="iform-response">
                        <span className="iform-response-value">{String(existingResponse.value)}</span>
                        <span className="iform-response-by">— {existingResponse.filled_by.username}</span>
                    </div>
                </div>
            );
        }
        const val = values[field.id];
        switch (field.type) {
            case 'checkbox':
                return (
                    <div key={field.id} className="iform-field iform-field--checkbox">
                        <input type="checkbox" id={field.id} checked={!!val}
                            onChange={e => setValues(v => ({ ...v, [field.id]: e.target.checked }))}
                            disabled={!canSubmit} />
                        <label htmlFor={field.id} className="iform-label">{field.label}</label>
                    </div>
                );
            case 'select':
                return (
                    <div key={field.id} className="iform-field">
                        <label className="iform-label">{field.label}</label>
                        <select className="iform-select" value={String(val ?? '')}
                            onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))}
                            disabled={!canSubmit}>
                            <option value="">Choisir...</option>
                            {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                );
            case 'textarea':
                return (
                    <div key={field.id} className="iform-field">
                        <label className="iform-label">{field.label}</label>
                        <textarea className="iform-textarea" placeholder={field.placeholder}
                            value={String(val ?? '')}
                            onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))}
                            disabled={!canSubmit} rows={3} />
                    </div>
                );
            default:
                return (
                    <div key={field.id} className="iform-field">
                        <label className="iform-label">{field.label}</label>
                        <input className="iform-input" type={field.type === 'number' ? 'number' : 'text'}
                            placeholder={field.placeholder} value={String(val ?? '')}
                            min={field.min} max={field.max}
                            onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))}
                            disabled={!canSubmit} />
                    </div>
                );
        }
    };

    return (
        <div className={`interactive-form ${isMe ? 'interactive-form--mine' : ''}`}>
            {fields.map(renderField)}
            {canSubmit && (
                <button type="button" className="iform-submit" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? '...' : 'Envoyer'}
                </button>
            )}
            {submitted && <p className="iform-done">Réponse envoyée ✓</p>}
        </div>
    );
}

// ── Main MessageBubble ────────────────────────────────────────────────────────
function MessageBubbleComponent({
    message,
    isFirstInGroup,
    isLastInGroup,
    isSameSenderAsNext,
    isSameSenderAsPrev,
    isGroupConversation = false,
    reactionEmojis,
    replyParent,
    replyAncestry = [],
    replySiblingMessages = [],
    isReplyExpanded = false,
    senderColor,
    onToggleReplyExpanded,
    onReact,
    onReply,
}: MessageBubbleProps) {
    const { user } = useAuth();
    const [ctxMenu, setCtxMenu] = useState<DOMRect | null>(null);
    const [messageInfoEntries, setMessageInfoEntries] = useState<MessageInfoEntry[] | null>(null);
    const [messageInfoLoading, setMessageInfoLoading] = useState(false);
    const bubbleRef = useRef<HTMLDivElement>(null);

    const isMe =
        (message.sender_uuid && user?.uuid && message.sender_uuid === user.uuid) ||
        message.sender_username?.toLowerCase() === user?.username?.toLowerCase();

    const systemMessage = isSystemMessage(message);

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Don't open menu when clicking interactive elements inside the bubble
        const target = e.target as HTMLElement;
        if (target.closest('a, button, input, select, textarea, audio, video')) return;
        if (bubbleRef.current) setCtxMenu(bubbleRef.current.getBoundingClientRect());
    }, []);

    const handleCopy = useCallback(() => {
        if (message.content) navigator.clipboard.writeText(message.content).catch(() => {});
    }, [message.content]);

    const handleReport = useCallback(() => {
        alert('Signalement envoyé');
    }, []);

    const handleReact = useCallback((emoji: string) => {
        onReact?.(message.uuid, emoji);
    }, [message.uuid, onReact]);

    const handleReply = useCallback(() => {
        onReply?.(message);
    }, [message, onReply]);

    const handleInfo = useCallback(async () => {
        if (!message.conversation_uuid) return;

        setMessageInfoLoading(true);
        setMessageInfoEntries(null);

        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${message.conversation_uuid}/participants/`);
            if (!res.ok) throw new Error('Impossible de charger les infos');

            const detail = await res.json();
            const participants = (detail.participants || []) as ConversationParticipantDetail[];
            const messageCreatedAtMs = new Date(message.created_at).getTime();

            const entries = participants
                .filter((participant) => participant.user_uuid && participant.user_uuid !== user?.uuid)
                .map((participant) => {
                    let seenAt: string | null = null;

                    if (message.is_read && message.read_at && participants.length <= 2) {
                        seenAt = String(message.read_at);
                    } else if (participant.last_seen) {
                        const participantSeenAtMs = new Date(participant.last_seen).getTime();
                        if (!Number.isNaN(participantSeenAtMs) && participantSeenAtMs >= messageCreatedAtMs) {
                            seenAt = participant.last_seen;
                        }
                    }

                    if (!seenAt) return null;

                    return {
                        userUuid: participant.user_uuid || participant.username,
                        label: participant.surnom || participant.username,
                        seenAt,
                    };
                })
                .filter((entry): entry is MessageInfoEntry => !!entry)
                .sort((left, right) => new Date(right.seenAt).getTime() - new Date(left.seenAt).getTime());

            setMessageInfoEntries(entries);
        } catch {
            setMessageInfoEntries([]);
        } finally {
            setMessageInfoLoading(false);
        }
    }, [message.conversation_uuid, message.created_at, message.is_read, message.read_at, user?.uuid]);

    if (systemMessage) {
        return (
            <div className="system-message-container">
                <span className="system-message-text">{message.content}</span>
                <span className="system-message-time">
                    {new Date(message.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        );
    }

    const bubbleClasses = ['message-bubble'];
    if (isMe) {
        bubbleClasses.push('my-message');
        bubbleClasses.push(isSameSenderAsPrev ? 'same-prev-mine' : 'not-same-prev-mine');
        bubbleClasses.push(isSameSenderAsNext ? 'same-next-mine' : 'not-same-next-mine');
    } else {
        bubbleClasses.push('their-message');
        bubbleClasses.push(isSameSenderAsPrev ? 'same-prev-theirs' : 'not-same-prev-theirs');
        bubbleClasses.push(isSameSenderAsNext ? 'same-next-theirs' : 'not-same-next-theirs');
    }
    if (message.isPending) bubbleClasses.push('pending-message');

    const formattedTime = new Date(message.created_at).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit',
    });

    const renderContent = (content: string) => renderFormattedText(content, `msg-${message.uuid}`, {
        textClassName: isMe ? 'my-message-text' : 'their-message-text',
        linkClassName: isMe ? 'my-link-text' : 'their-link-text',
        inlineCodeClassName: isMe ? 'message-inline-code message-inline-code--mine' : 'message-inline-code message-inline-code--theirs',
        codeBlockClassName: isMe ? 'message-code-block message-code-block--mine' : 'message-code-block message-code-block--theirs',
        headingClassName: 'message-heading',
        headingToneClassName: isMe ? 'message-heading--mine' : 'message-heading--theirs',
    });

    const attachments = message.attachments ?? [];
    const imageAttachments = attachments.filter((attachment) => getAttachmentKind(attachment) === 'image');
    const nonImageAttachments = attachments.filter((attachment) => getAttachmentKind(attachment) !== 'image');
    const hasAttachmentCaption = !!message.content?.trim()
        && (!attachments.some(attachment => getAttachmentKind(attachment) === 'audio') || message.content.trim() !== 'Message vocal');
    if (attachments.length > 0 && !attachments.every(attachment => getAttachmentKind(attachment) === 'audio')) {
        bubbleClasses.push('message-bubble--attachments');
    }
    const isInteractive = message.interactive_data?.is_interactive === true
        && !message.interactive_data?.hidden_meta?.is_form_response;
    const hasExpandedReplyDetails = replyAncestry.length > 0 || replySiblingMessages.length > 0;

    const renderReplyPreviewText = (targetMessage: Message) => {
        if (targetMessage.attachments?.length) {
            return '📎 Pièce jointe';
        }
        return getFirstNonEmptyLine(targetMessage.content);
    };

    const renderReplyContext = () => {
        if (!replyParent) return null;

        return (
            <div className={`reply-quote ${isMe ? 'reply-quote--mine' : 'reply-quote--theirs'}`}>
                <button
                    type="button"
                    className="reply-quote__header"
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleReplyExpanded?.(message.uuid);
                    }}
                    disabled={!hasExpandedReplyDetails}
                >
                    <div className="reply-quote__header-text">
                        <span className="reply-quote__sender">Réponse à {replyParent.sender_username || 'message'}</span>
                        {!isReplyExpanded && (
                            <span className="reply-quote__text">
                                {renderReplyPreviewText(replyParent)}
                            </span>
                        )}
                    </div>
                    {hasExpandedReplyDetails && (
                        <span className="reply-quote__chevron" aria-hidden="true">
                            {isReplyExpanded ? <IoChevronUp size={15} /> : <IoChevronDown size={15} />}
                        </span>
                    )}
                </button>

                {isReplyExpanded && hasExpandedReplyDetails && (
                    <div className="reply-quote__expanded">
                        {replyAncestry.length > 0 && (
                            <div className="reply-quote__chain">
                                {replyAncestry.map((chainMessage, index) => {
                                    const isDirectParent = index === replyAncestry.length - 1;
                                    return (
                                        <div
                                            key={chainMessage.uuid}
                                            className={`reply-quote__chain-bubble${isDirectParent ? ' reply-quote__chain-bubble--direct' : ''}`}
                                        >
                                            <span className="reply-quote__chain-author">
                                                {chainMessage.sender_username || 'Inconnu'}
                                            </span>
                                            <span className="reply-quote__chain-text">
                                                {isDirectParent
                                                    ? (chainMessage.content?.trim() ? chainMessage.content : renderReplyPreviewText(chainMessage))
                                                    : renderReplyPreviewText(chainMessage)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {replySiblingMessages.length > 0 && (
                            <div className="reply-quote__siblings">
                                <span className="reply-quote__siblings-title">Autres réponses au même parent</span>
                                <div className="reply-quote__siblings-list">
                                    {replySiblingMessages.map((siblingMessage) => (
                                        <div key={siblingMessage.uuid} className="reply-quote__sibling-bubble">
                                            <span className="reply-quote__sibling-author">
                                                {siblingMessage.sender_username || 'Inconnu'}
                                            </span>
                                            <span className="reply-quote__sibling-text">
                                                {renderReplyPreviewText(siblingMessage)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <div
                className={`message-wrapper ${isMe ? 'message-wrapper-mine' : 'message-wrapper-theirs'}${ctxMenu ? ' message-wrapper--active' : ''}`}
                style={ctxMenu ? { position: 'relative', zIndex: 9999 } : undefined}
            >
                <div className={`message-content-row${isMe ? ' message-content-row--mine' : ''}`}>
                    {isLastInGroup && (
                        <div className={`message-meta ${isMe ? 'message-meta--mine' : 'message-meta--theirs'}`}>
                            <span className="message-meta__time">{formattedTime}</span>
                            {isMe && (
                                <>
                                    {message.isPending ? (
                                        <span className="status-icon pending" aria-label="Envoi en cours"><IoTimeOutline size={12} /></span>
                                    ) : message.sendError ? (
                                        <span className="status-icon error" aria-label="Erreur d'envoi"><IoWarningOutline size={12} /></span>
                                    ) : message.is_read ? (
                                        <span className="status-icon read" aria-label="Vu"><IoCheckmarkDone size={13} /></span>
                                    ) : (
                                        <span className="status-icon delivered" aria-label="Distribué"><IoCheckmark size={12} /></span>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <div
                        ref={bubbleRef}
                        className={`${bubbleClasses.join(' ')}${reactionEmojis && reactionEmojis.length > 0 ? ' has-reaction' : ''}${ctxMenu ? ' message-bubble--active' : ''}`}
                        onClick={handleClick}
                    >
                        {/* Sender name for group chats */}
                        {!isMe && isFirstInGroup && isGroupConversation && (
                            <div className="sender-name" style={{ color: senderColor || getUserColor(message.sender_username, message.sender_uuid), marginTop: 0, marginBottom: 4, marginLeft: 0 }}>
                                {message.sender_username}
                            </div>
                        )}
                        {renderReplyContext()}

                        {attachments.length > 0 && (
                            <div className="attachment-stack">
                                {imageAttachments.length > 1 && (
                                    <ImageAttachmentGrid attachments={imageAttachments} messageUuid={message.uuid} />
                                )}
                                {(imageAttachments.length > 1 ? nonImageAttachments : attachments).map((att, index) => (
                                    <div key={buildAttachmentKey(message.uuid, att, index)} className="attachment-item">
                                        {getAttachmentKind(att) === 'image' ? (
                                            <ImageAttachment attachment={att} />
                                        ) : getAttachmentKind(att) === 'audio' ? (
                                            <AudioAttachment url={getAttachmentUrl(att)} isMe={!!isMe} durationHint={att.duration} />
                                        ) : getAttachmentKind(att) === 'video' ? (
                                            <VideoAttachment url={getAttachmentUrl(att)} thumbnailUrl={getAttachmentThumbnailUrl(att)} />
                                        ) : (
                                            <AdaptiveFileAttachment attachment={att} />
                                        )}
                                    </div>
                                ))}
                                {hasAttachmentCaption && (
                                    <div className={`attachment-caption ${isMe ? 'attachment-caption--mine' : 'attachment-caption--theirs'}`}>
                                        {renderContent(message.content)}
                                    </div>
                                )}
                            </div>
                        )}

                        {isInteractive && message.interactive_data && (
                            <InteractiveForm data={message.interactive_data} messageUuid={message.uuid} isMe={!!isMe} />
                        )}

                        {message.content && attachments.length === 0 && (
                            <div className={`message-text ${isMe ? 'my-message-text' : 'their-message-text'}`}>
                                <WebLinkPreview content={message.content} />
                                {renderContent(message.content)}
                            </div>
                        )}

                        {/* Reaction chips — positioned absolutely on the bubble, toward screen center */}
                        {reactionEmojis && reactionEmojis.length > 0 && (
                            <div className={`reaction-badges ${isMe ? 'reaction-badges--mine' : 'reaction-badges--theirs'}`}>
                                {reactionEmojis.map((emoji, i) => (
                                    <span key={`${message.uuid}-${emoji}-${i}`} className="reaction-badge">{emoji}</span>
                                ))}
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {ctxMenu && (
                <MessageContextMenu
                    bubbleRect={ctxMenu}
                    isMe={!!isMe}
                    messageContent={message.content ?? ''}
                    onReact={handleReact}
                    onReply={handleReply}
                    onCopy={handleCopy}
                    onInfo={() => { void handleInfo(); }}
                    onReport={handleReport}
                    onClose={() => setCtxMenu(null)}
                />
            )}

            {messageInfoLoading && (
                <div className="message-info-overlay" onMouseDown={() => setMessageInfoLoading(false)}>
                    <div className="message-info-card" onMouseDown={(event) => event.stopPropagation()}>
                        <div className="message-info-card__title">Infos du message</div>
                        <div className="message-info-card__subtitle">Chargement...</div>
                    </div>
                </div>
            )}

            {messageInfoEntries && !messageInfoLoading && (
                <div className="message-info-overlay" onMouseDown={() => setMessageInfoEntries(null)}>
                    <div className="message-info-card" onMouseDown={(event) => event.stopPropagation()}>
                        <div className="message-info-card__title">Infos du message</div>
                        <div className="message-info-card__subtitle">
                            {messageInfoEntries.length > 0 ? 'Vu par' : 'Aucune lecture confirmée pour l’instant'}
                        </div>
                        {messageInfoEntries.length > 0 && (
                            <div className="message-info-card__list">
                                {messageInfoEntries.map((entry) => (
                                    <div key={entry.userUuid} className="message-info-card__row">
                                        <span className="message-info-card__name">{entry.label}</span>
                                        <span className="message-info-card__time">
                                            {new Date(entry.seenAt).toLocaleString('fr-FR', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

const areReactionListsEqual = (left?: string[], right?: string[]): boolean => {
    if (left === right) return true;
    if (!left || !right) return !left && !right;
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
};

export const MessageBubble = React.memo(MessageBubbleComponent, (prev, next) => {
    return (
        prev.message === next.message &&
        prev.isFirstInGroup === next.isFirstInGroup &&
        prev.isLastInGroup === next.isLastInGroup &&
        prev.isSameSenderAsNext === next.isSameSenderAsNext &&
        prev.isSameSenderAsPrev === next.isSameSenderAsPrev &&
        prev.isGroupConversation === next.isGroupConversation &&
        prev.replyParent?.uuid === next.replyParent?.uuid &&
        prev.replyParent?.content === next.replyParent?.content &&
        prev.replyAncestry === next.replyAncestry &&
        prev.replySiblingMessages === next.replySiblingMessages &&
        prev.isReplyExpanded === next.isReplyExpanded &&
        areReactionListsEqual(prev.reactionEmojis, next.reactionEmojis)
    );
});
