import { userRepo } from "../repos/user-repo";
import { removeDeep } from "./deep";

export const userService = {
  list: () => userRepo.findAll(),
  remove: (id: string) => removeDeep(id),
};
