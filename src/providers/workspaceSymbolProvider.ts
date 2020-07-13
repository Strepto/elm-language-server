import {
  IConnection,
  SymbolInformation,
  WorkspaceSymbolParams,
} from "vscode-languageserver";
import { SyntaxNode, TreeCursor } from "web-tree-sitter";
import { IElmWorkspace } from "../elmWorkspace";
import { SymbolInformationTranslator } from "../util/symbolTranslator";
import Fuzzysort from "fuzzysort";

export class WorkspaceSymbolProvider {
  constructor(
    private readonly connection: IConnection,
    private readonly elmWorkspaces: IElmWorkspace[],
  ) {
    this.connection.onWorkspaceSymbol(this.handleWorkspaceSymbolRequest);
  }

  protected handleWorkspaceSymbolRequest = (
    param: WorkspaceSymbolParams,
  ): SymbolInformation[] | null | undefined => {
    const handleWorkspaceSymbolRequestTimer = "handleWorkspaceSymbolRequest";
    console.time(handleWorkspaceSymbolRequestTimer);

    this.connection.console.info(`Workspace Symbols were requested`);

    type SystemInformationAndFuzzScore = {
      symbolInformation: SymbolInformation;
      fuzzScore: number;
    };

    const symbolInformationAndFuzzScoreMap: Map<
      string,
      SystemInformationAndFuzzScore[]
    > = new Map<string, SystemInformationAndFuzzScore[]>();

    const query = param.query;
    const queryUpper = param.query.toUpperCase();
    const fuzzyScoreThreshold = -100; // TODO: This value is "randomly" chosen based on gut feeling. Could just as well be -1000

    // Documentation: https://github.com/microsoft/vscode/blob/97fc588e65bedcb1113baeddd2f67237e52c8c63/src/vs/vscode.d.ts#L2857-L2874
    const fuzzysort = Fuzzysort.new({
      allowTypo: false, // Visual Studio does not handle typos when filtering in frontend, so we might as well ignore it here as well to save some potential milliseconds.
      threshold: fuzzyScoreThreshold, // Exit early if the nodes score is too low (returns null).
    });

    this.elmWorkspaces.forEach((elmWorkspace) => {
      elmWorkspace.getForest().treeIndex.forEach((tree) => {
        const parseNode: (node: SyntaxNode) => void = (
          node: SyntaxNode,
        ): void => {
          let maybeFuzzScore = null;
          if (query && node.text.length < 512) {
            maybeFuzzScore = fuzzysort.single(query, node.text);
          }
          // fuzzysort will return null for items that have too low score.
          // If the query is empty we need to match everything.
          if (!query || maybeFuzzScore) {
            //if (node.text.toUpperCase().includes(queryUpper)) {
            //  !query || maybeFuzzScore)
            const fuzzScore = maybeFuzzScore?.score ?? fuzzyScoreThreshold; // This should not happen, but the linter does not like to use "!" asserting non-undefined/null
            const symbolInformation = SymbolInformationTranslator.translateNodeToSymbolInformation(
              tree.uri,
              node,
            );

            if (symbolInformation) {
              const current =
                symbolInformationAndFuzzScoreMap.get(tree.uri) || [];
              symbolInformationAndFuzzScoreMap.set(tree.uri, [
                ...current,
                { symbolInformation, fuzzScore },
              ]);
            }
          }
        };

        // skip URIs already traversed in a previous Elm workspace
        if (tree && !symbolInformationAndFuzzScoreMap.get(tree.uri)) {
          // Traverse the TreeCursor
          const treeCursor = tree.tree.rootNode.walk();

          do {
            parseNode(treeCursor.currentNode());
          } while (this.moveNextDepthFirst(treeCursor));
        }
      });
    });

    const result = Array.from(symbolInformationAndFuzzScoreMap.values())
      .flat()
      .sort((a, b) => (a.fuzzScore > b.fuzzScore ? -1 : 1)) // TODO: This is an optional feature, as VS Code does not care at all about this but some other editors might?
      .map((x) => x.symbolInformation);

    console.timeEnd(handleWorkspaceSymbolRequestTimer);
    return result;
  };

  // Incrementally performing a preorder walk of an N-ary tree
  // https://devblogs.microsoft.com/oldnewthing/20200107-00/?p=103304
  private moveNextDepthFirst = (treeCursor: TreeCursor): boolean => {
    if (treeCursor.gotoFirstChild()) {
      return true;
    }
    do {
      if (treeCursor.gotoNextSibling()) {
        return true;
      }
    } while (treeCursor.gotoParent());
    return false;
  };
}
