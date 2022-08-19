import * as t from 'io-ts';

export const StringNumber = (
  name: string,
  validate: t.Validate<string, number>
): t.Type<number, string, string> => {
  return new t.Type<number, string, string>(name, t.number.is, validate, String);
};
