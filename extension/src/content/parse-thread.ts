import { extractGeneric, type ThreadExtract } from "./generic-thread";
import { extractHn, isHn } from "./hn";
import { extractGithub, isGithubIssue } from "./github";

export function parseThread(doc: Document = document): ThreadExtract {
  if (isHn(doc)) return extractHn(doc);
  if (isGithubIssue(doc)) return extractGithub(doc);
  return extractGeneric(doc);
}
