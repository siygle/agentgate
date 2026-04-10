export type ApiResponse<T> = {
  success: true;
  data: T;
};

export type ApiErrorResponse = {
  success: false;
  error: string;
};

export function ok<T>(data: T, status = 200) {
  return Response.json({ success: true, data } as ApiResponse<T>, { status });
}

export function err(error: unknown, status = 400) {
  return Response.json({ success: false, error } as ApiErrorResponse, {
    status,
  });
}
