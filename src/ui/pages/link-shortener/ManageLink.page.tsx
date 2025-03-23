import {
  Title,
  Box,
  TextInput,
  Textarea,
  Switch,
  Select,
  Button,
  Loader,
  TextInputProps,
  getSize,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm, zodResolver } from '@mantine/form';
import { MultiSelect } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { AuthGuard } from '@ui/components/AuthGuard';
import { getRunEnvironmentConfig } from '@ui/config';
import { useApi } from '@ui/util/api';
import { OrganizationList as orgList } from '@common/orgs';
import { AppRoles } from '@common/roles';
import { IconScale } from '@tabler/icons-react';
import { environmentConfig } from '@common/config';

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const baseUrl = 'https://go.acm.illinois.edu'; //Move to config in future?
const slugRegex = new RegExp('^(https?://)?[a-zA-Z0-9-._/]*$');
const urlRegex = new RegExp('^https?://[a-zA-Z0-9-._/?=]*$');

const baseBodySchema = z
  .object({
    slug: z
      .string()
      .min(1, 'Enter or generate an alias')
      .regex(
        slugRegex,
        "Invalid input: Only alphanumeric characters, '-', '_', '/', and '.' are allowed"
      )
      .optional(),
    access: z.array(z.string()).min(1, 'Choose at least 1 access group').optional(),
    redirect: z
      .string()
      .min(1)
      .regex(urlRegex, 'Invalid URL. Use format: http:// or https://www.example.com')
      .optional(),
    createdAtUtc: z.number().optional(),
    updatedAtUtc: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.slug?.length || 0) * 2 >= (data.redirect?.length || 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slug'],
        message: 'Shortened URL cannot be that long',
      }); //Throw custom error through context using superrefine
    }
  });

const requestBodySchema = baseBodySchema;

type LinkPostRequest = z.infer<typeof requestBodySchema>;

export const ManageLinkPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [accessGroup, setAccessGroup] = useState<any[]>();

  useEffect(() => {
    const fetchAccessGroup = async () => {
      try {
        const config = await getRunEnvironmentConfig();
        if (config.LinkryGroupList) {
          setAccessGroup(config.LinkryGroupList);
        }
      } catch (error) {
        console.error('Failed to fetch access group config:', error);
        notifications.show({
          message: 'Failed to fetch access group config.',
        });
      } finally {
        //setLoading(false);
      }
    };

    fetchAccessGroup();
  }, []);

  const navigate = useNavigate();
  const api = useApi('core');

  const { slug } = useParams();

  const isEditing = slug !== undefined;

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    // Fetch event data and populate form
    const startForm = async () => {
      try {
        setIsLoading(true);
        const response = await api.get(`/api/v1/linkry/linkdata/${slug}`);
        const linkData = response.data;
        const formValues = {
          slug: linkData.slug,
          access: linkData.access,
          redirect: linkData.redirect,
        };
        form.setValues(formValues);
        setIsLoading(false);
      } catch (error) {
        console.error('Error fetching event data:', error);
        notifications.show({
          message: 'Failed to fetch event data, please try again.',
        });
        navigate('/link-shortener');
      }
    };
    startForm();
  }, [slug, isEditing]);

  const form = useForm<LinkPostRequest>({
    validate: zodResolver(requestBodySchema),
    initialValues: {
      slug: '',
      access: [],
      redirect: '',
    },
  });

  const handleSubmit = async (values: LinkPostRequest) => {
    /*if (!values.access || values.redirect || !values.slug){
      notifications.show({
        message: "Please fill in all entries",
      });
    }  */ //Potential warning for fields that are not filled...
    try {
      setIsSubmitting(true);
      const realValues = {
        ...values,
      };

      const linkURL = isEditing ? `/api/v1/linkry/redir/${slug}` : '/api/v1/linkry/redir';
      const response = isEditing
        ? await api.patch(linkURL, realValues)
        : await api.post(linkURL, realValues);
      notifications.show({
        title: isEditing ? 'Link updated!' : 'Link created!',
        message: isEditing
          ? undefined
          : `The Link: ${realValues.redirect}, ${realValues.slug} ${realValues.access}".`,
      });
      navigate('/link-shortener');
    } catch (error) {
      setIsSubmitting(false);
      console.error('Error creating/editing link:', error);
      notifications.show({
        message: isEditing ? 'Failed to Edit Link' : 'Failed to Create Link',
      });
    }
  };

  const handleFormClose = () => {
    navigate('/link-shortener');
  };

  const generateRandomSlug = () => {
    const randomSlug = Array.from(
      { length: 6 },
      () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 52)]
    ).join('');
    form.setFieldValue('slug', randomSlug);
  };

  const handleSlug = (event: React.ChangeEvent<HTMLInputElement>) => {
    form.setFieldValue('slug', event.currentTarget.value);
  };

  /*
  const calculateRenderWidth = (str: string) => {
    const span = document.createElement('button');
    document.body.appendChild(span);
    span.textContent = str;
    const width = span.offsetWidth;
    document.body.removeChild(span);
    return width;
  }; */ //VERY crude solution...

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.LINKS_MANAGER] }}>
      <Box
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(255, 255, 255, 0.7)', // semi-transparent background
          display: isLoading ? 'flex' : 'none',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999, // make sure it’s on top
        }}
      >
        <Loader size={48} color="blue" />
      </Box>
      <Box display="flex" ta="center" mt="1.5rem">
        <Title order={2}>{isEditing ? 'Edit' : 'Add'} Link</Title>
        <Button variant="subtle" ml="auto" onClick={handleFormClose}>
          Close
        </Button>
      </Box>
      <Box maw={650} mx="auto" mt="100px">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label={isEditing ? 'Edit URL Here' : 'Paste URL to be Shortened'}
            withAsterisk
            mt="xl"
            {...form.getInputProps('redirect')}
          />

          <TextInput
            label={isEditing ? 'Edit Shortened URL Here' : 'Enter or Generate a Shortened URL'}
            withAsterisk
            leftSectionWidth={'230px'}
            rightSectionWidth={'150px'}
            leftSection={
              <Button variant="outline" mr="auto" size="auto">
                {baseUrl + '/' || 'https://domain/'}
              </Button>
            }
            rightSection={
              !isEditing && (
                <Button variant="filled" ml="auto" color="blue" onClick={generateRandomSlug}>
                  Random URL
                </Button>
              )
            }
            mt="xl"
            {...{ ...form.getInputProps('slug'), onChange: handleSlug }}
          />

          <MultiSelect
            label={isEditing ? 'Change Access Group Here' : 'Select Access Groups'}
            withAsterisk
            data={accessGroup}
            mt="xl"
            {...form.getInputProps('access')}
          />

          <Button
            type="submit"
            mt="30px"
            w="125px"
            style={{ marginLeft: 'auto', display: 'block' }}
          >
            {isSubmitting ? (
              <>
                <Loader size={16} color="white" />
                Submitting...
              </>
            ) : (
              `${isEditing ? 'Save' : 'Create'} Link`
            )}
          </Button>
        </form>
      </Box>
    </AuthGuard>
  );
};
