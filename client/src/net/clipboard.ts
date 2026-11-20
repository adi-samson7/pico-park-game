// ==========================================
// COPY TO CLIPBOARD
// ==========================================
//
// navigator.clipboard only exists on secure
// origins (https:// or localhost). A game
// opened over plain http on a LAN address has
// to use the old way: select the text in a
// hidden <textarea> and run document.execCommand
// ("copy"). Both are tried; the result says
// whether either worked.
//
// The browser objects are passed in so this can
// be tested without a browser.

export interface ClipboardLike {

  writeText(text: string): Promise<void>;
}

export interface TextareaLike {

  value: string;

  style: Record<string, string>;

  setAttribute(name: string, value: string): void;

  focus(): void;

  select(): void;

  setSelectionRange?(start: number, end: number): void;

  remove(): void;
}

export interface DocumentLike {

  body: { appendChild(node: any): any };

  createElement(tag: "textarea"): TextareaLike;

  execCommand(command: "copy"): boolean;
}

export interface ClipboardEnvironment {

  clipboard?: ClipboardLike | null;

  document?: DocumentLike | null;
}

export async function copyToClipboard(
  text: string,
  env: ClipboardEnvironment =
    browserEnvironment()
): Promise<boolean> {

  if (!text) {
    return false;
  }

  // The modern way.

  if (env.clipboard) {

    try {

      await env.clipboard.writeText(text);

      return true;

    } catch {
      // Not allowed (permissions, insecure
      // origin, unfocused page): fall through.
    }
  }

  // The old way.

  const doc = env.document;

  if (!doc) {
    return false;
  }

  let box: TextareaLike | null = null;

  try {

    box = doc.createElement("textarea");

    box.value = text;

    box.setAttribute("readonly", "");

    // Off screen, and not scrolling the page.
    box.style.position = "fixed";
    box.style.top = "0";
    box.style.left = "-9999px";
    box.style.opacity = "0";

    doc.body.appendChild(box);

    box.focus();

    box.select();

    box.setSelectionRange?.(0, text.length);

    return doc.execCommand("copy") === true;

  } catch {

    return false;

  } finally {

    try {
      box?.remove();
    } catch {
      // ignore
    }
  }
}

function browserEnvironment():
  ClipboardEnvironment {

  if (typeof window === "undefined") {
    return {};
  }

  return {

    clipboard:
      typeof navigator !== "undefined"
        ? navigator.clipboard
        : null,

    document:
      window.document as unknown as
        DocumentLike
  };
}
