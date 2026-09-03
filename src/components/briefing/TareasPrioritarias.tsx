import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NoteSpacing, Radii, Shadows, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/animations';
import { EditorialTaskItem } from '@/components/EditorialTaskItem';
import { useTareasStore } from '@/stores/tareas';
import { normalizeDueDate, type TareaRow } from '@/db/queries/tareas';

export interface TareasPrioritariasProps {
  tareas?: TareaRow[];
  todayKey?: string; // ponytail: viene del padre (stableNow) para no quedar stale tras medianoche
  onPressItem?: (id: number) => void;
  onToggleItem?: (id: number) => void;
}

const PRIORITY_RANK: Record<string, number> = {
  alta: 0, high: 0,
  media: 1, medium: 1,
  baja: 2, low: 2,
};

function todayISO(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// V1 "Hoy": pending con fecha <= hoy (vencidas incluidas). Sin fecha y
// futuras quedan fuera (viven en la ruta secundaria /tareas).
// Orden: vencidas primero, prioridad desc, fallback due_date asc.
function selectTareasDeHoy(all: TareaRow[], hoy: string): TareaRow[] {
  return all
    .map((t) => ({ ...t, due_date: normalizeDueDate(t.due_date, hoy) }))
    .filter((t) => {
      if (t.status === 'completed') return false;
      return t.due_date !== null && t.due_date <= hoy;
    })
    .sort((a, b) => {
      const aOverdue = (a.due_date ?? '') < hoy ? 0 : 1;
      const bOverdue = (b.due_date ?? '') < hoy ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const pa = a.priority ? PRIORITY_RANK[a.priority] ?? 3 : 3;
      const pb = b.priority ? PRIORITY_RANK[b.priority] ?? 3 : 3;
      if (pa !== pb) return pa - pb;
      return (a.due_date ?? '').localeCompare(b.due_date ?? '');
    });
}

// ponytail: empty state es placeholder card (override del spec original),
// NO null — TareasPrioritarias debe ser siempre visible para que el
// usuario vea el feedback. Mantener misma forma visual que la lista real.
export function TareasPrioritarias({
  tareas,
  todayKey,
  onPressItem,
  onToggleItem,
}: TareasPrioritariasProps): React.ReactElement {
  const theme = useTheme();
  const storeItems = useTareasStore((s) => s.items);
  const toggleStatus = useTareasStore((s) => s.toggleStatus);

  // ponytail: todayKey viene del padre (que refresca en useFocusEffect) para
  // evitar que hoy quede stale si la app se deja abierta tras medianoche.
  const hoy = useMemo(() => todayKey ?? todayISO(), [todayKey]);
  const filtered = useMemo(
    () => selectTareasDeHoy(tareas ?? storeItems, hoy),
    [tareas, storeItems, hoy],
  );

  const cardStyle = {
    backgroundColor: theme.notes.bg.surface,
    borderColor: theme.notes.border.subtle,
  };

  const handleToggle = (id: number) => {
    void haptic.tap.medium();
    if (onToggleItem) {
      onToggleItem(id);
    } else {
      void toggleStatus(id);
    }
  };

  if (filtered.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={[styles.title, { color: theme.notes.text.secondary }]}>
          TAREAS DE HOY
        </Text>
        <View style={[styles.card, cardStyle, Shadows.sm]}>
          <Text style={[styles.emptyText, { color: theme.notes.text.muted }]}>
            Sin tareas para hoy 🎉
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: theme.notes.text.secondary }]}>
        TAREAS DE HOY
      </Text>
      <View style={[styles.card, cardStyle, Shadows.sm]}>
        {filtered.map((t) => (
          <EditorialTaskItem
            key={t.id}
            title={t.title}
            status={t.status}
            dueDate={t.due_date}
            priority={t.priority}
            onToggle={() => handleToggle(t.id)}
            onPress={
              onPressItem
                ? () => onPressItem(t.id)
                : undefined
            }
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: NoteSpacing.sm,
  },
  title: {
    ...Typography.eyebrow,
  },
  card: {
    borderWidth: 1,
    borderRadius: Radii.lg,
    paddingHorizontal: NoteSpacing.md,
  },
  emptyText: {
    ...Typography.body,
    textAlign: 'center',
    paddingVertical: NoteSpacing.md,
  },
});
