import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { DetailSheet } from '../../ui/DetailSheet.js';
import { useI18n } from '../../i18n/useI18n.js';
import type { KnowledgeAccessInput, KnowledgeAdminTreeNode } from '../../services/knowledgeApi.js';

interface KnowledgeCategorySettingsSheetProps {
  category: KnowledgeAdminTreeNode | null;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onSave: (
    categoryId: string,
    access: KnowledgeAccessInput,
    expectedAccessRevision?: string
  ) => Promise<void>;
}

export function KnowledgeCategorySettingsSheet({
  category,
  busy,
  open,
  onClose,
  onSave,
}: KnowledgeCategorySettingsSheetProps): ReactElement {
  const { messages } = useI18n();
  const app = messages.app;
  const copy = app.adminKnowledge;
  const [gate, setGate] = useState<'approved' | 'level' | 'excluded'>('approved');
  const [requiredLevel, setRequiredLevel] = useState(1);
  const editableCategory = category?.categoryId === null || category === null ? null : category;

  useEffect(() => {
    if (category?.categoryAccess === null || category?.categoryAccess === undefined) {
      return;
    }

    setGate(category.categoryAccess.gate === 'public' ? 'approved' : category.categoryAccess.gate);
    setRequiredLevel(category.categoryAccess.requiredLevel ?? 1);
  }, [category]);

  const levels = Array.from({ length: 10 }, (_, index) => index + 1);

  return (
    <DetailSheet
      closeLabel={app.commonActions.close}
      open={open}
      title={copy.categorySettings}
      onClose={onClose}
    >
      {editableCategory === null ? null : (
        <form
          className="knowledge-sheet-body knowledge-sheet-form knowledge-category-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(
              editableCategory.categoryId ?? editableCategory.id,
              {
                gate,
                requiredLevel: gate === 'level' ? requiredLevel : null,
              },
              editableCategory.accessRevision ?? undefined
            ).then(onClose);
          }}
        >
          <p className="muted-copy">
            <strong>{copy.category}:</strong> {editableCategory.title}
          </p>
          <p className="muted-copy">{copy.accessSettingsScope}</p>
          <fieldset className="knowledge-access-options">
            <legend>{copy.accessQuestion}</legend>
            <label
              className={['knowledge-access-option', gate === 'approved' ? 'selected' : null]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                checked={gate === 'approved'}
                name="knowledge-category-access"
                type="radio"
                onChange={() => {
                  setGate('approved');
                }}
              />
              <span>
                <strong>{copy.accessEveryoneLabel}</strong>
                <small>{copy.accessEveryoneHelp}</small>
              </span>
            </label>
            <label
              className={['knowledge-access-option', gate === 'level' ? 'selected' : null]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                checked={gate === 'level'}
                name="knowledge-category-access"
                type="radio"
                onChange={() => {
                  setGate('level');
                }}
              />
              <span>
                <strong>{copy.accessLevelLabel}</strong>
                <small>{copy.accessLevelHelp}</small>
              </span>
            </label>
            <div className="knowledge-level-selector" aria-label={copy.requiredLevel}>
              {levels.map((level) => (
                <button
                  className={gate === 'level' && requiredLevel === level ? 'selected' : undefined}
                  key={level}
                  type="button"
                  onClick={() => {
                    setGate('level');
                    setRequiredLevel(level);
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
            <label
              className={['knowledge-access-option', gate === 'excluded' ? 'selected' : null]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                checked={gate === 'excluded'}
                name="knowledge-category-access"
                type="radio"
                onChange={() => {
                  setGate('excluded');
                }}
              />
              <span>
                <strong>{copy.accessPrivateLabel}</strong>
                <small>{copy.accessPrivateHelp}</small>
              </span>
            </label>
          </fieldset>
          <p className="muted-copy">{copy.accessPublishAfterSave}</p>
          <div className="toolbar-actions editor-actions">
            <button className="fa-primary-button" disabled={busy} type="submit">
              {copy.saveAccess}
            </button>
          </div>
        </form>
      )}
    </DetailSheet>
  );
}
