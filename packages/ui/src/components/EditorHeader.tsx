import { SkaitchMark } from './SkaitchMark';
import type { ReactNode } from 'react';
import { ArrowLeft, Undo2, Redo2, Sparkles, MoreHorizontal } from 'lucide-react';
import ToolbarMenu from './ToolbarMenu';
import { makeT } from '@skaitch/core/data/i18n';

export default function EditorHeader({ projectName, lang, onHome, undo, redo, canUndo, canRedo,
  onAssistant, assistantOpen = false, actions, options, context,
}: {
  projectName: string; lang: string; onHome: () => void; undo: () => void; redo: () => void;
  canUndo: boolean; canRedo: boolean; onAssistant: () => void; assistantOpen?: boolean;
  actions?: ReactNode; options: ReactNode; context?: ReactNode;
}) {
  const t = makeT(lang);
  return <header className="editor-header">
    <div className="editor-project">
      <button className="header-home" onClick={onHome} title={t('Projects')} aria-label={t('Projects')}>
        <ArrowLeft size={16} /><SkaitchMark size={24} /><span className="header-monogram skaitch-wordmark">sk<b>ai</b>tch</span>
      </button>
      <div className="editor-project-name"><span>{t('project')}</span><strong title={projectName}>{projectName}</strong></div>
    </div>
    <div className="editor-history" role="group" aria-label={`${t('Undo')} / ${t('Redo')}`}>
      <button className="header-command header-command-icon" onClick={undo} disabled={!canUndo} title={`${t('Undo')} · Ctrl+Z`} aria-label={t('Undo')}><Undo2 size={18}/></button>
      <button className="header-command header-command-icon" onClick={redo} disabled={!canRedo} title={`${t('Redo')} · Ctrl+Shift+Z`} aria-label={t('Redo')}><Redo2 size={18}/></button>
    </div>
    {actions && <div className="editor-file-actions">{actions}</div>}
    {context && <div className="editor-header-context">{context}</div>}
    <div className="editor-utilities">
      <button className="header-command header-assistant" onClick={onAssistant} aria-pressed={assistantOpen} title={t('assistant')}>
        <Sparkles size={16}/><span>{t('assistant')}</span>
      </button>
      <ToolbarMenu label={t('More')} lang={lang} icon={<MoreHorizontal size={20}/>}><div className="toolbar-mobile-files">{actions}</div>{options}</ToolbarMenu>
    </div>
  </header>;
}
