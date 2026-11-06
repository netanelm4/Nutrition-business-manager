import { useQuery } from '@tanstack/react-query';
import { fetchMenu } from '../../lib/api';

// Read-only view of a menu's meals and items, inline in the client's "תפריטים" tab.
// Editing happens in the menu editor (/clients/:id/menus/:menuId).

const ITEM_LABEL = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירק', fruit: 'פרי', daily_basket: 'סל יומי', custom: '' };

function portionsLabel(item) {
  if (item.item_type === 'custom') return '';
  const p = Number(item.portions);
  if (item.item_type === 'daily_basket') return `${p} אופציות`;
  if (p === 0.5) return 'חצי מנה';
  return p === 1 ? 'מנה' : `${p} מנות`;
}

export default function MenuInlinePreview({ menuId }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['menu', String(menuId)], queryFn: () => fetchMenu(menuId) });
  if (isLoading) return <div className="animate-pulse rounded-lg" style={{ height: 60, background: 'var(--surface-3)' }} />;
  if (isError || !data) return <p style={{ fontSize: 12, color: 'var(--red-ink)', margin: 0 }}>טעינת התפריט נכשלה.</p>;
  const { menu, meals } = data;

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {menu.notes && <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0, whiteSpace: 'pre-wrap' }}>{menu.notes}</p>}
      {meals.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0 }}>אין עדיין ארוחות בתפריט.</p>}
      {meals.map((meal) => (
        <div key={meal.id} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ fontSize: 13, color: 'var(--ink-1)' }}>{meal.meal_name}</strong>
            {meal.time_label && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{meal.time_label}</span>}
          </div>
          {meal.notes && <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '2px 0 0' }}>{meal.notes}</p>}
          <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {meal.items.map((item) => (
              <li key={item.id} style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                {item.item_type !== 'custom' && (
                  <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>
                    {ITEM_LABEL[item.item_type] || item.item_type}{portionsLabel(item) ? ` (${portionsLabel(item)})` : ''}:{' '}
                  </span>
                )}
                {item.item_type === 'custom' && '• '}
                {item.custom_text}
                {item.notes && <span style={{ color: 'var(--ink-3)' }}> · {item.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
