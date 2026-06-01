"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DIMENSIONS,
  DIMENSION_BY_KEY,
  OPERATORS_BY_TYPE,
  VALUELESS_OPERATORS,
  emptyGroup,
  type Condition,
  type ConditionGroup,
  type ConditionLeaf,
  type DimensionCategory,
} from "@/lib/sequences/conditions";

const selectCls =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const CATEGORIES: DimensionCategory[] = ["contact", "company", "behavior"];
const dimKey = (k: string) => k.replace(/\./g, "_");

/**
 * Recursive Klaviyo-style AND/OR condition builder. A group toggles AND/OR and
 * holds a list of leaves and nested groups. Leaves are dimension → operator →
 * value rows (value hidden for valueless operators). Pure controlled component.
 */
export function ConditionBuilder({
  value,
  onChange,
}: {
  value: ConditionGroup;
  onChange: (group: ConditionGroup) => void;
}) {
  return <GroupEditor group={value} onChange={onChange} depth={0} />;
}

function GroupEditor({
  group,
  onChange,
  depth,
}: {
  group: ConditionGroup;
  onChange: (group: ConditionGroup) => void;
  depth: number;
}) {
  const t = useTranslations("pages.sequences.cond");

  const setChild = (i: number, child: Condition) =>
    onChange({ ...group, conditions: group.conditions.map((c, idx) => (idx === i ? child : c)) });
  const removeChild = (i: number) =>
    onChange({ ...group, conditions: group.conditions.filter((_, idx) => idx !== i) });
  const addLeaf = () =>
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { kind: "leaf", dimension: DIMENSIONS[0]!.key, operator: OPERATORS_BY_TYPE[DIMENSIONS[0]!.type][0]! },
      ],
    });
  const addGroup = () => onChange({ ...group, conditions: [...group.conditions, emptyGroup()] });

  return (
    <div className={depth > 0 ? "rounded-md border border-border bg-secondary/30 p-2" : ""}>
      {group.conditions.length > 1 && (
        <div className="mb-2 inline-flex overflow-hidden rounded-md border border-border text-xs">
          {(["and", "or"] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange({ ...group, op })}
              className={group.op === op ? "bg-brand-teal px-2 py-0.5 text-white" : "px-2 py-0.5 text-muted-foreground"}
            >
              {t(op)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {group.conditions.map((c, i) =>
          c.kind === "group" ? (
            <div key={i} className="flex items-start gap-1">
              <div className="flex-1">
                <GroupEditor group={c} onChange={(g) => setChild(i, g)} depth={depth + 1} />
              </div>
              <RemoveBtn onClick={() => removeChild(i)} />
            </div>
          ) : (
            <LeafEditor key={i} leaf={c} onChange={(l) => setChild(i, l)} onRemove={() => removeChild(i)} />
          ),
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <button type="button" onClick={addLeaf} className="inline-flex items-center gap-1 text-xs text-brand-teal hover:underline">
          <Plus className="h-3 w-3" />
          {t("addCondition")}
        </button>
        {depth < 2 && (
          <button type="button" onClick={addGroup} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            <Plus className="h-3 w-3" />
            {t("addGroup")}
          </button>
        )}
      </div>
    </div>
  );
}

function LeafEditor({
  leaf,
  onChange,
  onRemove,
}: {
  leaf: ConditionLeaf;
  onChange: (leaf: ConditionLeaf) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("pages.sequences.cond");
  const def = DIMENSION_BY_KEY[leaf.dimension];
  const operators = def ? OPERATORS_BY_TYPE[def.type] : [];
  const showValue = !VALUELESS_OPERATORS.has(leaf.operator);

  return (
    <div className="flex items-start gap-1">
      <div className="flex-1 space-y-1.5 rounded-md border border-border bg-background p-2">
        <select
          className={selectCls}
          value={leaf.dimension}
          onChange={(e) => {
            const d = DIMENSION_BY_KEY[e.target.value]!;
            onChange({ kind: "leaf", dimension: d.key, operator: OPERATORS_BY_TYPE[d.type][0]!, value: undefined });
          }}
        >
          {CATEGORIES.map((cat) => (
            <optgroup key={cat} label={t(`cat.${cat}`)}>
              {DIMENSIONS.filter((d) => d.category === cat).map((d) => (
                <option key={d.key} value={d.key}>
                  {t(`dim.${dimKey(d.key)}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex gap-1.5">
          <select
            className={selectCls}
            value={leaf.operator}
            onChange={(e) => onChange({ ...leaf, operator: e.target.value })}
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {t(`op.${op}`)}
              </option>
            ))}
          </select>
          {showValue &&
            (def?.type === "enum" ? (
              <select
                className={selectCls}
                value={leaf.value ?? ""}
                onChange={(e) => onChange({ ...leaf, value: e.target.value })}
              >
                <option value="">—</option>
                {def.values?.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                className="h-8"
                value={leaf.value ?? ""}
                placeholder={t("valuePlaceholder")}
                onChange={(e) => onChange({ ...leaf, value: e.target.value })}
              />
            ))}
        </div>
        {SCOPE_AWARE_DIMENSIONS.has(leaf.dimension) && (
          <div className="pt-1 border-t border-border/60">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="shrink-0">{t("scopeLabel")}</span>
              <select
                className={selectCls}
                value={leaf.scope ?? "any"}
                onChange={(e) =>
                  onChange({
                    ...leaf,
                    scope:
                      e.target.value === "this_sequence" ? "this_sequence" : "any",
                  })
                }
              >
                <option value="any">{t("scope.any")}</option>
                <option value="this_sequence">{t("scope.this_sequence")}</option>
              </select>
            </label>
          </div>
        )}
      </div>
      <RemoveBtn onClick={onRemove} />
    </div>
  );
}

/**
 * Dimensions where the "scope: this sequence only" toggle is meaningful.
 * For other dimensions (contact.*, company.*, behavior.callNoAnswer), the
 * concept doesn't apply and we hide the selector to keep the leaf compact.
 */
const SCOPE_AWARE_DIMENSIONS = new Set([
  "behavior.replied",
  "behavior.positiveReply",
  "behavior.negativeReply",
]);

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 text-muted-foreground hover:text-destructive"
      aria-label="remove"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
