import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptBar } from './PromptBar.js';

describe('PromptBar', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('grows the textarea to reveal long prompts before sending', () => {
    const onChange = vi.fn();

    render(
      <PromptBar
        label="Question"
        placeholder="Ask"
        sendLabel="Send"
        value=""
        onChange={onChange}
        onSubmit={vi.fn()}
      />
    );

    const textarea = screen.getByRole('textbox', { name: 'Question' });
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 196,
    });

    fireEvent.change(textarea, {
      target: {
        value:
          'Explain a long placeholder prompt that exercises resizing behavior without domain advice.',
      },
    });

    expect(textarea.style.height).toBe('196px');
    expect(textarea.style.overflowY).toBe('hidden');
    expect(onChange).toHaveBeenCalledWith(
      'Explain a long placeholder prompt that exercises resizing behavior without domain advice.'
    );
  });

  it('keeps very long prompts scrollable once the mobile composer reaches its cap', () => {
    vi.stubGlobal('innerHeight', 480);

    render(
      <PromptBar
        label="Question"
        placeholder="Ask"
        sendLabel="Send"
        value="Line 1"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const textarea = screen.getByRole('textbox', { name: 'Question' });
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 320,
    });

    fireEvent.change(textarea, {
      target: {
        value: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8',
      },
    });

    expect(textarea.style.height).toBe('173px');
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('renders the send action as an icon-only button with an accessible name', () => {
    render(
      <PromptBar
        label="Question"
        placeholder="Ask"
        sendLabel="Send"
        value="What should I cast?"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeEnabled();
    expect(sendButton).toHaveTextContent('');
  });

  it('turns the send action into an enabled stop control while streaming', () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();

    render(
      <PromptBar
        disabled
        label="Question"
        placeholder="Ask"
        sendLabel="Send"
        stopLabel="Stop"
        value="Waiting for the answer"
        onChange={vi.fn()}
        onStop={onStop}
        onSubmit={onSubmit}
      />
    );

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Enter as a newline key instead of submitting the prompt', () => {
    const onSubmit = vi.fn();

    render(
      <PromptBar
        label="Question"
        placeholder="Ask"
        sendLabel="Send"
        value="Line 1"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question' }), {
      key: 'Enter',
      code: 'Enter',
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
