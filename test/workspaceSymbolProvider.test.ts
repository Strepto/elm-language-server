import { WorkspaceSymbolProvider } from "../src/providers";
import { SourceTreeParser } from "./utils/sourceTreeParser";
import { mockDeep } from "jest-mock-extended";
import {
  WorkspaceSymbolParams,
  SymbolInformation,
  IConnection,
} from "vscode-languageserver";
import { getInvokeAndTargetPositionFromSource } from "./utils/sourceParser";

class MockCompletionProvider extends WorkspaceSymbolProvider {
  public handleWorkspaceSymbol(
    params: WorkspaceSymbolParams,
  ): SymbolInformation[] | null | undefined {
    return this.handleWorkspaceSymbolRequest(params);
  }
}

describe("WorkspaceSymbolProvider", async () => {
  const connectionMock = mockDeep<IConnection>();

  const source = `
  --@ Test.elm
  module Test exposing (..)
  
  type alias Model = 
    { prop1: String
    , prop2: Int
    }
  
  view : Model -> Model
  view model =
    { model | p{-caret-} }
  `;
  const treeParser = new SourceTreeParser();
  await treeParser.init();
  const completionProvider = new MockCompletionProvider(connectionMock, [
    treeParser.getWorkspace(
      getInvokeAndTargetPositionFromSource(source).sources,
    ),
  ]);

  it("Should Match Exactly", async () => {
    let result = completionProvider.handleWorkspaceSymbol({ query: "view" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("view");
  });
});
