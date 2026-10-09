import { formatBalance, getInitials, summarizeMembers } from "../lib/format";
import type { Group } from "../types";
import "./GroupRow.css";

// Warna avatar dipilih dari nama grup, jadi grup yang sama selalu berwarna sama.
const AVATAR_COLORS = ["#fc71ce", "#fdd302", "#7fe0b0", "#8fb4ff", "#ffa66b"];

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function GroupRow({ group }: { group: Group }) {
  const balanceTone = group.balance > 0 ? "positive" : group.balance < 0 ? "negative" : "settled";

  return (
    <li className="group-row">
      <div className="group-row__avatar" style={{ background: colorFor(group.name) }} aria-hidden="true">
        {getInitials(group.name)}
      </div>
      <div className="group-row__body">
        <div className="group-row__heading">
          <h2 className="group-row__name">{group.name}</h2>
          <span className={`group-row__balance group-row__balance--${balanceTone}`}>
            {formatBalance(group.balance)}
          </span>
        </div>
        <p className="group-row__members">{summarizeMembers(group.members)}</p>
      </div>
    </li>
  );
}
