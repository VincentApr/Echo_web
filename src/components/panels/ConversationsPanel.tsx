import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useConversations, type Conversation } from '../../hooks/useConversations';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import {
  IoSearchOutline, IoAdd,
  IoChevronDownOutline, IoChevronUpOutline,
} from 'react-icons/io5';
import { fetchWithAuth } from '@mobile/services/apiClient';
import { API_BASE_URL } from '@mobile/config/api';
import './ConversationsPanel.css';

interface ConversationsPanelProps {
  filter: 'private' | 'groups' | 'agents';
  onSearchExpansionChange?: (expanded: boolean) => void;
  columns?: number;
}

interface GroupMeta {
  id: number;
  uuid: string;
  name: string;
  avatar?: string | null;
  parent: number | null;
  subgroups_count?: number;
}

interface SubgroupInfo {
  id: number;
  uuid: string;
  name: string;
  avatar?: string | null;
  member_count: number;
  conversation_uuid?: string | null;
}

// Number of columns in the groups grid (matches repeat(auto-fill, 80px) at typical sidebar width)
export default function ConversationsPanel({ filter, onSearchExpansionChange, columns = 1 }: ConversationsPanelProps) {
  const { isLoggedIn } = useAuth();
  const { privateConversations, groupConversations, agentConversations, isLoading } = useConversations();
  const { openConversation, selectedConversation, navigate } = useNavigation();
  const [search, setSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showTwoColumns, setShowTwoColumns] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const columnsCloseTimerRef = useRef<number | null>(null);
  const [groupMeta, setGroupMeta] = useState<GroupMeta[]>([]);
  const [expandedGroupUuids, setExpandedGroupUuids] = useState<Record<string, boolean>>({});
  const [fetchedSubgroups, setFetchedSubgroups] = useState<Record<string, SubgroupInfo[]>>({});
  const [loadingExpand, setLoadingExpand] = useState<Record<string, boolean>>({});
  const isSearchBarExpanded = isSearchOpen || columns > 1 || showTwoColumns;

  const setSearchOpen = (open: boolean) => {
    if (columnsCloseTimerRef.current !== null) window.clearTimeout(columnsCloseTimerRef.current);
    setIsSearchOpen(open);
    onSearchExpansionChange?.(open);
    if (open) {
      setShowTwoColumns(true);
    } else {
      setSearch('');
      columnsCloseTimerRef.current = window.setTimeout(() => {
        setShowTwoColumns(false);
        columnsCloseTimerRef.current = null;
      }, 350);
    }
  };

  useEffect(() => {
    if (!isSearchOpen) return;
    const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 180);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!searchWrapRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [isSearchOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (columnsCloseTimerRef.current !== null) window.clearTimeout(columnsCloseTimerRef.current);
    onSearchExpansionChange?.(false);
  }, [onSearchExpansionChange]);

  useEffect(() => {
    if (columns === 1 && !isSearchOpen && !showTwoColumns) setSearch('');
  }, [columns, isSearchOpen, showTwoColumns]);

  // ── Fetch group hierarchy metadata when in groups mode ──
  useEffect(() => {
    if (filter !== 'groups') return;
    void fetchWithAuth(`${API_BASE_URL}/groups/my-groups/`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        const payload = data as { results?: GroupMeta[] };
        setGroupMeta(Array.isArray(data) ? data : payload.results ?? []);
      });
  }, [filter]);

  // ── Hierarchy maps ──
  const groupMetaByUuid = useMemo(() => {
    const map = new Map<string, GroupMeta>();
    groupMeta.forEach(g => map.set(g.uuid, g));
    return map;
  }, [groupMeta]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<number, GroupMeta[]>();
    groupMeta.forEach(g => {
      if (g.parent === null) return;
      const list = map.get(g.parent) ?? [];
      list.push(g);
      map.set(g.parent, list);
    });
    return map;
  }, [groupMeta]);

  const convByGroupUuid = useMemo(() => {
    const map = new Map<string, Conversation>();
    groupConversations.forEach(c => {
      if (c.group_info?.uuid) map.set(c.group_info.uuid, c);
    });
    return map;
  }, [groupConversations]);

  if (!isLoggedIn) {
    return (
      <div className={`conv-panel conv-panel--${filter}`}>
        <p className="conv-panel__empty">Connectez-vous pour voir vos conversations.</p>
      </div>
    );
  }

  let conversations: Conversation[] = [];
  let emptyText = 'Aucune conversation';
  switch (filter) {
    case 'private':  conversations = privateConversations; emptyText = 'Aucune conversation'; break;
    case 'groups':   conversations = groupConversations;   emptyText = 'Aucun groupe';        break;
    case 'agents':   conversations = agentConversations;   emptyText = 'Aucun historique Jarvis'; break;
  }

  const filtered = search.trim()
    ? conversations.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // ── Helpers ──
  const getSubgroupConvs = (conv: Conversation): Conversation[] => {
    const meta = conv.group_info?.uuid ? groupMetaByUuid.get(conv.group_info.uuid) : null;
    if (!meta) return [];
    return (childrenByParentId.get(meta.id) ?? [])
      .map(child => convByGroupUuid.get(child.uuid))
      .filter(Boolean) as Conversation[];
  };

  const isRootGroup = (conv: Conversation): boolean => {
    const meta = conv.group_info?.uuid ? groupMetaByUuid.get(conv.group_info.uuid) : null;
    // If no metadata yet (still loading), show everything as root
    return !meta || meta.parent === null;
  };

  const toggleExpand = async (conv: Conversation) => {
    const convUuid = conv.uuid;
    const groupUuid = conv.group_info?.uuid;
    const isCurrentlyExpanded = !!expandedGroupUuids[convUuid];
    setExpandedGroupUuids(prev => ({ ...prev, [convUuid]: !isCurrentlyExpanded }));
    // Fetch subgroups on first expand (always fetch, even if already in fetchedSubgroups,
    // so we get fresh data with conversation_uuid from the updated serializer)
    if (!isCurrentlyExpanded && groupUuid) {
      setLoadingExpand(prev => ({ ...prev, [convUuid]: true }));
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/groups/${groupUuid}/`);
        if (res.ok) {
          const detail = await res.json();
          setFetchedSubgroups(prev => ({ ...prev, [convUuid]: detail.subgroups ?? [] }));
        }
      } finally {
        setLoadingExpand(prev => ({ ...prev, [convUuid]: false }));
      }
    }
  };

  const getSubgroupConvsForDisplay = (conv: Conversation): Conversation[] => {
    const fetched = fetchedSubgroups[conv.uuid];
    // fetched is undefined = not yet fetched; [] = fetched but empty; [...] = has data
    if (fetched !== undefined) {
      return fetched.map(s => {
        // Prefer the loaded conversation (has unread count, is_read, etc.)
        const cached = convByGroupUuid.get(s.uuid);
        if (cached) return cached;
        // Fall back to building from fetched metadata
        const convUuid = s.conversation_uuid;
        if (!convUuid) return null;
        return {
          uuid: convUuid,
          unread_count: 0,
          conversation_type: 'group' as const,
          name: s.name,
          avatar_url: s.avatar || '',
          group_info: { uuid: s.uuid, name: s.name, avatar: s.avatar || null, member_count: s.member_count },
        } satisfies Conversation;
      }).filter((c): c is Conversation => c !== null);
    }
    return getSubgroupConvs(conv);
  };

  // ── Render a single conversation square ──
  const renderSquare = (conv: Conversation, opts?: { isSubgroup?: boolean }) => {
    const isSelected   = selectedConversation?.uuid === conv.uuid;
    const hasUnread    = conv.unread_count > 0;
    const isAgent      = conv.conversation_type === 'agent';
    const subgroups    = filter === 'groups' ? getSubgroupConvs(conv) : [];
    const convMeta     = conv.group_info?.uuid ? groupMetaByUuid.get(conv.group_info.uuid) : null;
    const hasChildren  = convMeta ? (convMeta.subgroups_count ?? 0) > 0 : subgroups.length > 0;
    const isExpanded   = !!expandedGroupUuids[conv.uuid];

    return (
      <button
        key={conv.uuid}
        className={[
          'conv-square',
          hasUnread           ? 'conv-square--unread'        : '',
          isSelected          ? 'conv-square--selected'      : '',
          isAgent             ? 'conv-square--agent'         : '',
          opts?.isSubgroup    ? 'conv-square--subgroup'      : '',
        ].filter(Boolean).join(' ')}
        onClick={() => { setSearchOpen(false); openConversation(conv); }}
        title={conv.name}
      >
        {conv.avatar_url ? (
          <img src={conv.avatar_url} alt={conv.name} className="conv-square__avatar" />
        ) : (
          <div className="conv-square__avatar-placeholder">
            {conv.name.charAt(0).toUpperCase()}
          </div>
        )}

        {hasUnread && (
          <span className="conv-square__unread-badge">
            {conv.unread_count > 99 ? '99+' : conv.unread_count}
          </span>
        )}

        <div
          className={`conv-square__name-badge${hasChildren ? ' conv-square__name-badge--expandable' : ''}`}
          role={hasChildren ? 'button' : undefined}
          aria-label={hasChildren ? (isExpanded ? 'Réduire' : 'Voir les sous-groupes') : undefined}
          onClick={hasChildren ? e => { e.stopPropagation(); void toggleExpand(conv); } : undefined}
        >
          <span className="conv-square__name">{conv.name}</span>
          {hasChildren && (
            <span className="conv-square__chevron">
              {isExpanded
                ? <IoChevronUpOutline size={11} />
                : <IoChevronDownOutline size={11} />}
            </span>
          )}
        </div>
      </button>
    );
  };

  // ── Groups grid with inline subgroup expansion (mirrors mobile row logic) ──
  const renderGroupsGrid = () => {
    // When searching, show flat list (both roots and subgroups that match)
    if (search.trim()) {
      return (
        <div className="conv-panel__grid">
          <button
            className="conv-square conv-square--add"
            title="Nouveau groupe"
            onClick={() => navigate('add-group')}
          >
            <IoAdd size={38} color="rgba(10, 145, 104, 1)" />
            <div className="conv-square__name-badge"><span className="conv-square__name">Nouveau</span></div>
          </button>
          {filtered.map(conv => renderSquare(conv))}
        </div>
      );
    }

    // Root groups only in main grid
    const rootConvs = filtered.filter(isRootGroup);

    // Build rows of GRID_COLS, with "add" button occupying the first slot
    const slots: Array<Conversation | '__add__'> = ['__add__', ...rootConvs];
    const rows: Array<Array<Conversation | '__add__'>> = [];
    const gridColumns = Math.max(columns, showTwoColumns ? 2 : 1);
    for (let i = 0; i < slots.length; i += gridColumns) {
      rows.push(slots.slice(i, i + gridColumns));
    }

    return (
      <div className="conv-panel__groups-layout">
        {rows.map((row, rowIdx) => {
          // Find the expanded group in this row (if any)
          const expandedConvInRow = row.find(
            item => item !== '__add__' && expandedGroupUuids[(item as Conversation).uuid]
          ) as Conversation | undefined;
          const subgroupConvs = expandedConvInRow ? getSubgroupConvsForDisplay(expandedConvInRow) : [];
          const isLoadingSubgroups = expandedConvInRow ? !!loadingExpand[expandedConvInRow.uuid] : false;
          const isExpanded = !!expandedConvInRow;

          return (
            <div key={rowIdx} className="conv-panel__group-row-block">
              {/* Row of parent squares */}
              <div className="conv-panel__grid conv-panel__grid--groups-row">
                {row.map(item =>
                  item === '__add__' ? (
                    <button
                      key="__add__"
                      className="conv-square conv-square--add"
                      title="Nouveau groupe"
                      onClick={() => navigate('add-group')}
                    >
                      <IoAdd size={38} color="rgba(10, 145, 104, 1)" />
                      <div className="conv-square__name-badge">
                        <span className="conv-square__name">Nouveau</span>
                      </div>
                    </button>
                  ) : renderSquare(item as Conversation)
                )}
              </div>

              {/* Inline subgroup expansion — appears right after the row */}
              {isExpanded && (
                <div className="conv-panel__subgroup-expansion">
                  {isLoadingSubgroups ? (
                    <div className="conv-panel__spinner conv-panel__spinner--sm" />
                  ) : subgroupConvs.length > 0 ? (
                    <div className="conv-panel__grid conv-panel__grid--subgroups">
                      {subgroupConvs.map(sub => renderSquare(sub, { isSubgroup: true }))}
                    </div>
                  ) : (
                    <p className="conv-panel__empty conv-panel__empty--sm">Aucun sous-groupe</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`conv-panel conv-panel--${filter} conv-panel--columns-${Math.max(columns, showTwoColumns ? 2 : 1)} ${isSearchBarExpanded ? 'conv-panel--search-open' : ''}`}>
      {/* Search bar */}
      <div ref={searchWrapRef} className="conv-panel__search-wrap" role={!isSearchBarExpanded ? 'button' : undefined} tabIndex={!isSearchBarExpanded ? 0 : undefined} onClick={() => { if (!isSearchBarExpanded) setSearchOpen(true); }} onKeyDown={event => { if (!isSearchBarExpanded && (event.key === 'Enter' || event.key === ' ')) setSearchOpen(true); }}>
        <IoSearchOutline size={16} className="conv-panel__search-icon" />
        <input
          ref={searchInputRef}
          className="conv-panel__search"
          placeholder=""
          aria-label="Rechercher une conversation"
          value={search}
          onChange={e => setSearch(e.target.value)}
          disabled={!isSearchBarExpanded}
        />
        {search && (
          <button className="conv-panel__search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      <div className="conv-panel__grid-scroll">
        {isLoading ? (
          <div className="conv-panel__loading">
            <div className="conv-panel__spinner" />
            <span>Chargement...</span>
          </div>
        ) : (
          <>
            {filter === 'groups' ? renderGroupsGrid() : (
              <div className={`conv-panel__grid${filter === 'private' ? ' conv-panel__grid--private' : ''}`}>
                <button
                  className="conv-square conv-square--add"
                  title={filter === 'agents' ? 'Nouvel agent' : 'Nouveau'}
                  onClick={() => navigate(filter === 'agents' ? 'add-agent' : 'add-friend')}
                >
                  <IoAdd size={38} color="rgba(10, 145, 104, 1)" />
                  <div className="conv-square__name-badge">
                    <span className="conv-square__name">Nouveau</span>
                  </div>
                </button>
                {filtered.map(conv => renderSquare(conv))}
              </div>
            )}

            {filtered.length === 0 && (
              <p className="conv-panel__empty">{search ? 'Aucun résultat' : emptyText}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
