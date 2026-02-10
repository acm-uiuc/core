import axios, { AxiosError } from "axios";
import { ReactNode, useMemo } from "react";

import { useAuth } from "@ui/components/AuthContext";
import { getRunEnvironmentConfig, ValidService } from "@ui/config";
import { HTTP_ERROR_MESSAGES } from "./errorCodes";
import { notifications } from "@mantine/notifications";

export const MAX_API_TIMEOUT_MS = 10000;

const createAxiosInstance = (baseURL: string) =>
  axios.create({
    baseURL,
    timeout: MAX_API_TIMEOUT_MS,
    timeoutErrorMessage: "The request timed out.",
  });

const useApi = (serviceName: ValidService) => {
  const { getToken, getApiToken, signOutOfApp } = useAuth();
  const api = useMemo(() => {
    const baseUrl =
      getRunEnvironmentConfig().ServiceConfiguration[serviceName].baseEndpoint;
    const instance = createAxiosInstance(baseUrl);

    instance.interceptors.request.use(
      async (config) => {
        const authToken = await getApiToken(serviceName);
        if (authToken) {
          config.headers.Authorization = `Bearer ${authToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error),
    );

    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          signOutOfApp();
        }
        return Promise.reject(error);
      },
    );

    return instance;
  }, [getToken, signOutOfApp]);

  return api;
};

type ParsedError = { code: number; message: string };

const parseError = async (e: unknown): Promise<ParsedError> => {
  const mostRefined = { code: 99, message: "An unknown error occurred." };
  if (!(e instanceof Error)) {
    return mostRefined;
  }
  mostRefined.message = e.message;
  if (!(e instanceof AxiosError)) {
    return mostRefined;
  }
  if (e.status) {
    mostRefined.code = e.status;
    mostRefined.message = HTTP_ERROR_MESSAGES[e.status];
  }
  if (e.response && e.response.data) {
    try {
      const responseJson = (await JSON.parse(e.response.data)) as {
        id?: number;
        message?: string;
      };
      if (responseJson.id && responseJson.message) {
        mostRefined.code = responseJson.id;
        mostRefined.message = responseJson.message;
      }
    } catch {
      return mostRefined;
    }
  }
  return mostRefined;
};

/**
 *
 * @param e The error which was thrown
 * @param operationName The user-friendly error description (for example: "loading short links" to output "An error ocurred while loading short links")
 * @param icon (Optional) The icon to show in the error popup
 */
const generateErrorMessage = async (
  e: unknown,
  operationName: string,
  icon?: ReactNode | undefined,
) => {
  console.error(`Error while ${operationName}: ${e}`);
  const parsedError = await parseError(e);
  const errorMessage = `Error ${parsedError.code}: ${parsedError.message}`;
  notifications.show({
    title: `An error occurred while ${operationName}`,
    message: errorMessage,
    color: "red",
    icon,
  });
};

export { useApi, generateErrorMessage };
