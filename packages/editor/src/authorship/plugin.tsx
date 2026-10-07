/**
 * Lends the editor to the authorship store.
 *
 * Turning an anchor into an element needs the Lexical editor, which only a
 * composer child can reach; the margin itself renders beside the document.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { addComposerChild$, realmPlugin } from "@mdxeditor/editor";

import type { AuthorshipStore } from "./store";

function AuthorshipObserver({ store }: { store: AuthorshipStore }) {
	let [editor] = useLexicalComposerContext();
	useEffect(() => {
		store.attach(editor);
		return () => store.attach(undefined);
	}, [editor, store]);
	return null;
}

export const authorshipPlugin = realmPlugin<{ store: AuthorshipStore }>({
	init(realm, params) {
		if (!params) return;
		let store = params.store;
		realm.pub(addComposerChild$, () => <AuthorshipObserver store={store} />);
	},
});
