/**
 * Faces for authors, following the product's one rule about faces: a person
 * is a rounded square, an agent a circle. An agent other than the Planner is
 * told apart by colour; who asked it rides on its face as a small badge.
 */

import { Face } from "../face";
import { authorColor, authorName } from "./model";

import type { Provenance } from "@chopin/protocol";

export function AuthorFace(
	{ author, size = 20, badge = true }: {
		author: Provenance.Author | undefined;
		size?: number;
		badge?: boolean;
	},
) {
	if (author?.type === "human") return <Face handle={author.handle} size={size} titled={false} />;
	if (author?.type !== "agent") {
		return (
			<span
				aria-hidden="true"
				className="authorship-system-face"
				style={{ width: size, height: size }}
			/>
		);
	}
	let small = Math.max(10, Math.round(size * 0.55));
	return (
		<span
			aria-label={authorName(author)}
			className="authorship-agent-face"
			role="img"
			style={{ width: size, height: size, background: authorColor(author) }}
		>
			{badge && author.for && (
				<span className="authorship-badge" data-tooltip={`For @${author.for}`}>
					<Face handle={author.for} size={small} titled={false} />
				</span>
			)}
		</span>
	);
}
