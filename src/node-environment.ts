import { TestEnvironment } from "jest-environment-node";
import { wrapEnvironmentClass } from "./wrapper";

export default wrapEnvironmentClass(TestEnvironment);
