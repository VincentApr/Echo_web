import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { IoChevronBackOutline, IoChevronForwardOutline, IoTimeOutline, IoLocationOutline, IoCalendarOutline } from 'react-icons/io5';

interface CalendarEvent {
    id: number;
    titre: string;
    description: string;
    date_debut: string;
    date_fin: string;
    type: string;
    lieu?: string;
    is_all_day: boolean;
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const EVENT_COLORS: Record<string, string> = {
    professionnel: '#10b981', personnel: '#3b82f6', anniversaire: '#f59e0b', autre: '#8b5cf6'
};

const fmtLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ExpandedCalendar() {
    const { accessToken } = useAuth();
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!accessToken) return;
        const fetchEvents = async () => {
            setLoading(true);
            try {
                const year = currentMonth.getFullYear();
                const month = currentMonth.getMonth() + 1;
                const res = await fetchWithAuth(`${API_BASE_URL}/calendrier/month/?year=${year}&month=${month}`);
                if (res.ok) {
                    const data = await res.json();
                    let evList = [];
                    if (Array.isArray(data)) evList = data;
                    else if (data.events) evList = data.events;
                    else if (data.evenements) evList = data.evenements;
                    else if (data.evenements_par_jour) {
                        Object.values(data.evenements_par_jour).forEach((arr: any) => {
                            if (Array.isArray(arr)) evList.push(...arr);
                        });
                    }
                    
                    setEvents(evList.map((e: any) => ({
                        id: e.id,
                        titre: e.titre || e.title || '',
                        description: e.description || '',
                        date_debut: e.date_debut || e.start || e.start_at || '',
                        date_fin: e.date_fin || e.end || e.end_at || '',
                        type: e.type || e.type_evenement || 'autre',
                        lieu: e.lieu || e.location,
                        is_all_day: !!e.is_all_day
                    })));
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchEvents();
    }, [accessToken, currentMonth]);

    const changeMonth = (dir: 'prev' | 'next') => {
        setCurrentMonth(prev => {
            const next = new Date(prev);
            next.setMonth(next.getMonth() + (dir === 'next' ? 1 : -1));
            return next;
        });
    };

    const daysInMonth = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startingDayOfWeek = (firstDay.getDay() + 6) % 7;

        const days: (number | null)[] = Array(startingDayOfWeek).fill(null);
        for (let i = 1; i <= lastDay.getDate(); i++) days.push(i);
        
        const weeks = [];
        for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
        return weeks;
    }, [currentMonth]);

    const eventsThisDay = useMemo(() => {
        const key = fmtLocalDate(selectedDate);
        return events.filter(e => e.date_debut && fmtLocalDate(new Date(e.date_debut)) === key);
    }, [events, selectedDate]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '20px' }}>
            {/* Header Mois */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '16px 20px', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)' }}>
                <button onClick={() => changeMonth('prev')} style={{ border: 'none', background: 'rgba(10,145,104,0.08)', width: '36px', height: '36px', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0a9168' }}>
                    <IoChevronBackOutline size={20} />
                </button>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1a2620' }}>{MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h3>
                <button onClick={() => changeMonth('next')} style={{ border: 'none', background: 'rgba(10,145,104,0.08)', width: '36px', height: '36px', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0a9168' }}>
                    <IoChevronForwardOutline size={20} />
                </button>
            </div>

            {/* Grille Calendrier */}
            <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)', padding: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: '8px' }}>
                    {WEEKDAYS.map(d => <span key={d} style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>{d}</span>)}
                </div>
                {daysInMonth.map((week, wIdx) => (
                    <div key={wIdx} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
                        {week.map((day, dIdx) => {
                            if (!day) return <div key={dIdx} />;
                            const isSelected = selectedDate.getDate() === day && selectedDate.getMonth() === currentMonth.getMonth() && selectedDate.getFullYear() === currentMonth.getFullYear();
                            const isToday = new Date().getDate() === day && new Date().getMonth() === currentMonth.getMonth() && new Date().getFullYear() === currentMonth.getFullYear();
                            const dayEvents = events.filter(e => e.date_debut && fmtLocalDate(new Date(e.date_debut)) === fmtLocalDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)));
                            
                            return (
                                <div key={dIdx} onClick={() => setSelectedDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))}
                                     style={{ height: '56px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '12px', background: isSelected ? 'rgba(10,145,104,1)' : (isToday ? 'rgba(10,145,104,0.08)' : 'transparent'), color: isSelected ? '#fff' : '#1a2620', transition: 'all 0.2s', border: isToday && !isSelected ? '1px solid rgba(10,145,104,0.3)' : 'border: 1px solid transparent' }}>
                                    <span style={{ fontSize: '15px', fontWeight: isSelected || isToday ? 700 : 500 }}>{day}</span>
                                    {dayEvents.length > 0 && (
                                        <div style={{ display: 'flex', gap: '2px', marginTop: '2px' }}>
                                            {dayEvents.slice(0, 3).map((_, i) => <div key={i} style={{ width: '4px', height: '4px', borderRadius: '2px', background: isSelected ? '#fff' : 'rgba(10,145,104,0.8)' }} />)}
                                            {dayEvents.length > 3 && <span style={{ fontSize: '9px', color: isSelected ? '#fff' : '#9ca3af', lineHeight: '4px' }}>+</span>}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* Événements du jour */}
            <div style={{ flex: 1, background: '#fff', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)', padding: '20px' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: '#1a2620', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '12px' }}>
                    {selectedDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h4>
                
                {eventsThisDay.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
                        <IoCalendarOutline size={48} style={{ opacity: 0.5, marginBottom: '8px' }} />
                        <p style={{ margin: 0, fontSize: '14px' }}>Aucun événement pour ce jour</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {eventsThisDay.map(ev => {
                            const color = EVENT_COLORS[ev.type] || EVENT_COLORS.autre;
                            const startStr = ev.date_debut ? new Date(ev.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
                            const endStr = ev.date_fin ? new Date(ev.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
                            return (
                                <div key={ev.id} style={{ display: 'flex', border: '1px solid rgba(0,0,0,0.05)', borderRadius: '12px', overflow: 'hidden' }}>
                                    <div style={{ width: '6px', background: color }} />
                                    <div style={{ padding: '12px 16px', flex: 1 }}>
                                        <h5 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#1a2620' }}>{ev.titre}</h5>
                                        {ev.description && <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#4b5563', lineHeight: 1.4 }}>{ev.description}</p>}
                                        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6b7a72' }}>
                                            {ev.is_all_day ? <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><IoTimeOutline /> Toute la journée</span> : 
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><IoTimeOutline /> {startStr} - {endStr}</span>}
                                            {ev.lieu && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><IoLocationOutline /> {ev.lieu}</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
