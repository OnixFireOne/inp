import type { Link } from '@/types/asset';

interface LinkListProps {
  links: Link[];
  category: string;
}

export function LinkList({ links, category }: LinkListProps) {
  const core = links.filter(l => l.tier === 'Core');
  const trusted = links.filter(l => l.tier === 'Trusted');

  return (
    <div className="mb-6">
      <div className="font-medium mb-2">{category}</div>
      {core.map(link => (
        <a key={link.id} href={link.href} target="_blank" className="block py-1 hover:text-[var(--accent)]">
          {link.name} {link.description && <span className="text-xs text-[var(--text-mut)]">— {link.description}</span>}
        </a>
      ))}
      <div className="flex flex-wrap gap-2 mt-2">
        {trusted.map(link => (
          <a key={link.id} href={link.href} target="_blank" className="px-3 py-1 text-sm rounded-full bg-[var(--surface-2)] hover:bg-[var(--surface)]">
            {link.name}
          </a>
        ))}
      </div>
    </div>
  );
}
