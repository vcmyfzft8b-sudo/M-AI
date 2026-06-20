export class ExpectedLectureInputError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExpectedLectureInputError";
    this.code = code;
  }
}

export function isExpectedLectureInputError(error: unknown) {
  return (
    error instanceof ExpectedLectureInputError ||
    (error instanceof Error && error.name === "ExpectedLectureInputError")
  );
}
