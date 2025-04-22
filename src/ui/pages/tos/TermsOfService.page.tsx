import React from 'react';
import { AcmAppShell } from '@ui/components/AppShell';
import {
  Title,
  Text,
  Container,
  Stack,
  Divider,
  List,
  Paper,
  Group,
  Anchor,
  ThemeIcon,
  Box,
  Center,
} from '@mantine/core';
import {
  IconInfoCircle,
  IconUser,
  IconShield,
  IconDatabase,
  IconBrandOpenSource,
  IconLicense,
  IconAlertCircle,
} from '@tabler/icons-react';

export const TermsOfService: React.FC = () => {
  return (
    <>
      <AcmAppShell showSidebar={false}>
        <Container size="lg" py="xl">
          <Stack gap="md">
            <Center>
              <Title order={1}>ACM @ UIUC Core Platform Terms of Service</Title>
            </Center>
            <Center>
              <Text size="sm" c="dimmed">
                Last Updated: April 21, 2025
              </Text>
            </Center>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="blue">
                  <IconInfoCircle size={20} />
                </ThemeIcon>
                <Title order={2}>1. Introduction</Title>
              </Group>

              <Text>
                These Terms of Service ("Terms") govern your access to and use of the ACM @ UIUC
                Core Platform, including the Core API, user interface, and related developer tools,
                documentation, and services (collectively, the "Core Platform") provided by the
                University of Illinois/Urbana ACM Student Chapter ("ACM @ UIUC," "we," "our," or
                "us").
              </Text>

              <Title order={3} mt="md">
                1.1 Agreement to Terms
              </Title>
              <Text>
                By accessing or using the Core Platform, you agree to be bound by these Terms. If
                you are using the Core Platform on behalf of an organization, you represent and
                warrant that you have the authority to bind that organization to these Terms.
              </Text>

              <Title order={3} mt="md">
                1.2 Open Source Project
              </Title>
              <Text>
                The ACM @ UIUC Core Platform is an open source project. The source code is available
                under the BSD 3-Clause License. These Terms govern your use of the Core Platform
                services and interfaces, while the BSD 3-Clause License governs your use of the
                source code. You are encouraged to review the source code, suggest improvements,
                report issues, and contribute to the development of the project in accordance with
                the project's contribution guidelines.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="green">
                  <IconLicense size={20} />
                </ThemeIcon>
                <Title order={2}>2. License Grant and Restrictions</Title>
              </Group>

              <Title order={3} mt="md">
                2.1 Platform Usage License
              </Title>
              <Text>
                Subject to your compliance with these Terms, ACM @ UIUC grants you a limited,
                non-exclusive, non-transferable, non-sublicensable, revocable license to access and
                use the Core Platform solely for the purpose of developing, testing, and supporting
                your application, website, or service that interfaces with the ACM @ UIUC Core
                Platform.
              </Text>

              <Title order={3} mt="md">
                2.2 Open Source Code License
              </Title>
              <Text>
                The ACM @ UIUC Core Platform source code is available under the BSD 3-Clause
                License. You can access, modify, and distribute the source code in accordance with
                the terms of that license. The full text of the BSD 3-Clause License can be found in
                the project repository.
              </Text>

              <Title order={3} mt="md">
                2.3 Restrictions on Platform Usage
              </Title>
              <Text mb="sm">
                While using the Core Platform (as distinct from the source code), you shall not, and
                shall not permit any third party to:
              </Text>
              <List spacing="xs" size="sm">
                <List.Item>
                  Use the Core Platform in any manner that could damage, disable, overburden, or
                  impair the ACM @ UIUC Core Platform or interfere with any other party's use of the
                  Core Platform
                </List.Item>
                <List.Item>
                  Use the Core Platform to violate any applicable law, regulation, or third-party
                  rights
                </List.Item>
                <List.Item>
                  Use the Core Platform to develop applications primarily intended to replace the
                  ACM @ UIUC Core Platform's core functionality
                </List.Item>
                <List.Item>
                  Sell, lease, or sublicense direct access to the ACM @ UIUC Core Platform endpoints
                  themselves without adding substantial value
                </List.Item>
                <List.Item>
                  Use the Core Platform to scrape, mine, or gather user data in an unauthorized
                  manner
                </List.Item>
                <List.Item>
                  Attempt to bypass or circumvent any security measures or access limitations of the
                  Core Platform
                </List.Item>
                <List.Item>
                  Use the Core Platform in a manner that exceeds reasonable request volume or
                  constitutes excessive or abusive usage
                </List.Item>
                <List.Item>
                  Use the Core Platform for advertising or marketing purposes by (i) targeting ads
                  based on Platform data, or (ii) serving ads based on Platform data
                </List.Item>
                <List.Item>
                  Misrepresent your identity or the nature of your application when requesting
                  authorization from users or using the Core Platform
                </List.Item>
                <List.Item>
                  Request from the Core Platform more than the minimum amount of data, or more than
                  the minimum permissions to the types of data, that your application needs to
                  function properly
                </List.Item>
              </List>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="red">
                  <IconShield size={20} />
                </ThemeIcon>
                <Title order={2}>3. Authentication and Access</Title>
              </Group>

              <Title order={3} mt="md">
                3.1 Authentication Methods
              </Title>
              <Text>Access to the Core Platform requires the use of either:</Text>
              <List spacing="xs" size="sm" mt="xs">
                <List.Item>
                  Bearer tokens obtained through the ACM @ UIUC Core Platform UI, or
                </List.Item>
                <List.Item>API tokens issued specifically for programmatic access</List.Item>
              </List>
              <Text mt="xs">
                You are responsible for keeping all tokens secure and confidential. You may not
                share your tokens with any third party or attempt to access the Core Platform using
                tokens not issued to you.
              </Text>

              <Title order={3} mt="md">
                3.2 Token Security
              </Title>
              <Text mb="xs">
                You must implement appropriate security measures to protect your tokens from
                unauthorized access, disclosure, or use. This includes, but is not limited to:
              </Text>
              <List spacing="xs" size="sm">
                <List.Item>Securely storing tokens</List.Item>
                <List.Item>Transmitting them only over encrypted connections (HTTPS)</List.Item>
                <List.Item>
                  Following the principle of least privilege when assigning token permissions
                </List.Item>
                <List.Item>Promptly revoking any compromised tokens</List.Item>
                <List.Item>
                  Not hardcoding tokens in client-side code or public repositories
                </List.Item>
                <List.Item>
                  Regularly rotating tokens when used in production environments
                </List.Item>
              </List>

              <Title order={3} mt="md">
                3.3 User Accounts
              </Title>
              <Text>
                If you create a user account on the Core Platform, you are responsible for
                maintaining the security of your account, and you are fully responsible for all
                activities that occur under the account. You must immediately notify ACM @ UIUC of
                any unauthorized uses of your account or any other breaches of security.
              </Text>

              <Title order={3} mt="md">
                3.4 Rate Limiting
              </Title>
              <Text>
                ACM @ UIUC reserves the right to set and enforce limits on your use of the Core
                Platform in terms of the number of API requests that may be made and the number of
                users you may serve. ACM @ UIUC may change these limits at any time, with or without
                notice. Rate limits are designed to ensure fair usage of resources and may vary
                based on the type of account or membership status.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="grape">
                  <IconDatabase size={20} />
                </ThemeIcon>
                <Title order={2}>4. User Data and Privacy</Title>
              </Group>

              <Title order={3} mt="md">
                4.1 Data Collection and Use
              </Title>
              <Text>If your application collects or processes user data:</Text>
              <List spacing="xs" size="sm" mt="xs">
                <List.Item>
                  You must maintain a privacy policy that clearly and accurately describes what user
                  data you collect and how you use and share such data with ACM @ UIUC and third
                  parties
                </List.Item>
                <List.Item>
                  You must obtain all necessary consents and provide all necessary disclosures
                  before collecting user data
                </List.Item>
                <List.Item>
                  You must comply with all applicable privacy and data protection laws and
                  regulations
                </List.Item>
                <List.Item>
                  You may not use any data accessed or obtained through the Core Platform for
                  advertising or marketing purposes
                </List.Item>
              </List>

              <Title order={3} mt="md">
                4.2 Data Security
              </Title>
              <Text>
                You must implement and maintain appropriate technical, physical, and administrative
                safeguards to protect user data from unauthorized access, use, or disclosure. You
                must promptly report any security breaches to ACM @ UIUC.
              </Text>

              <Title order={3} mt="md">
                4.3 User Control and Transparency
              </Title>
              <Text>Your application must provide users with clear means to:</Text>
              <List spacing="xs" size="sm" mt="xs">
                <List.Item>View what data your application has access to</List.Item>
                <List.Item>Revoke your application's access to their data</List.Item>
                <List.Item>
                  Request deletion of their data that you have obtained through the Core Platform
                </List.Item>
              </List>

              <Title order={3} mt="md">
                4.4 Data Retention
              </Title>
              <Text>
                You will only retain user data for as long as necessary to provide your
                application's functionality. If a user uninstalls your application, revokes
                authorization, or requests data deletion, you must promptly delete all of their data
                obtained through the Core Platform.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="orange">
                  <IconBrandOpenSource size={20} />
                </ThemeIcon>
                <Title order={2}>5. Branding and Publicity</Title>
              </Group>

              <Title order={3} mt="md">
                5.1 Attribution
              </Title>
              <Text>
                When displaying data or content obtained through the Core Platform, you must
                attribute ACM @ UIUC as the source by including a statement that clearly states the
                information was accessed through the ACM @ UIUC Core Platform.
              </Text>

              <Title order={3} mt="md">
                5.2 Use of Names and Logos
              </Title>
              <Text>
                You may not use the names, logos, or trademarks of ACM @ UIUC, ACM, University of
                Illinois, or any ACM @ UIUC affiliates without prior written permission, except as
                expressly permitted in these Terms or other written agreement.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="cyan">
                  <IconUser size={20} />
                </ThemeIcon>
                <Title order={2}>6. Service Modifications and Availability</Title>
              </Group>

              <Title order={3} mt="md">
                6.1 Modifications to the Platform
              </Title>
              <Text>
                ACM @ UIUC may modify the Core Platform, including adding, removing, or changing
                features or functionality, at any time and without liability to you. We will make
                reasonable efforts to provide notice of material changes.
              </Text>

              <Title order={3} mt="md">
                6.2 Monitoring and Quality Control
              </Title>
              <Text>
                You agree that ACM @ UIUC may monitor use of the Core Platform to ensure quality,
                improve the Core Platform, and verify your compliance with these Terms. This
                monitoring may include accessing and using your application that utilizes our Core
                Platform to identify security issues or compliance concerns.
              </Text>

              <Title order={3} mt="md">
                6.3 Availability and Support
              </Title>
              <Text>
                The Core Platform is provided on an "as is" and "as available" basis. ACM @ UIUC
                does not guarantee that the Core Platform will be available at all times or that it
                will be error-free. ACM @ UIUC does not provide any service level agreements or
                warranties regarding Core Platform availability or performance.
              </Text>

              <Title order={3} mt="md">
                6.4 Beta Features
              </Title>
              <Text>
                ACM @ UIUC may make available certain Core Platform features on a beta or preview
                basis. These features may be subject to additional terms and may not be as reliable
                as other features.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group mb="md">
                <ThemeIcon size="lg" variant="light" color="indigo">
                  <IconAlertCircle size={20} />
                </ThemeIcon>
                <Title order={2}>7. Term and Termination</Title>
              </Group>

              <Title order={3} mt="md">
                7.1 Term
              </Title>
              <Text>These Terms will remain in effect until terminated by you or ACM @ UIUC.</Text>

              <Title order={3} mt="md">
                7.2 Termination by You
              </Title>
              <Text>
                You may terminate these Terms at any time by ceasing all use of the Core Platform
                and destroying all API keys and related materials.
              </Text>

              <Title order={3} mt="md">
                7.3 Termination by ACM @ UIUC
              </Title>
              <Text>
                ACM @ UIUC may terminate these Terms or suspend or revoke your access to the Core
                Platform at any time for any reason without liability to you. Reasons for
                termination may include, but are not limited to:
              </Text>
              <List spacing="xs" size="sm" mt="xs">
                <List.Item>Violation of these Terms</List.Item>
                <List.Item>
                  ACM @ UIUC determines that your use of the Core Platform poses a security risk or
                  could harm other users
                </List.Item>
                <List.Item>ACM @ UIUC is required to do so by law</List.Item>
                <List.Item>ACM @ UIUC is no longer providing the Core Platform</List.Item>
              </List>

              <Title order={3} mt="md">
                7.4 Effect of Termination
              </Title>
              <Text>
                Upon termination, all licenses granted herein immediately expire, and you must cease
                all use of the Core Platform. Sections 4, 8, 9, 10, and 11 will survive termination.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={2} mb="md">
                8. Disclaimers
              </Title>
              <Text size="sm" fw={700}>
                THE CORE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY
                KIND, EITHER EXPRESS OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, IMPLIED WARRANTIES
                OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. ACM @
                UIUC DOES NOT WARRANT THAT THE CORE PLATFORM WILL BE UNINTERRUPTED OR ERROR-FREE, OR
                THAT DEFECTS WILL BE CORRECTED.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={2} mb="md">
                9. Limitation of Liability
              </Title>
              <Text size="sm" fw={700}>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL ACM @ UIUC, THE
                UNIVERSITY OF ILLINOIS, THEIR OFFICERS, DIRECTORS, EMPLOYEES, VOLUNTEERS, OR AGENTS
                BE LIABLE FOR ANY INDIRECT, PUNITIVE, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
                EXEMPLARY DAMAGES, INCLUDING WITHOUT LIMITATION DAMAGES FOR LOSS OF PROFITS,
                GOODWILL, USE, DATA, OR OTHER INTANGIBLE LOSSES, THAT RESULT FROM THE USE OF, OR
                INABILITY TO USE, THE CORE PLATFORM.
              </Text>
              <Divider my="md" />
              <Text size="sm" fw={700}>
                SINCE THE CORE PLATFORM IS PROVIDED FREE OF CHARGE, ACM @ UIUC'S MAXIMUM AGGREGATE
                LIABILITY TO YOU FOR ANY CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR YOUR
                USE OF THE CORE PLATFORM WILL NOT EXCEED $0 USD. IN THE EVENT YOU HAVE PAID FOR ANY
                PREMIUM SERVICES RELATED TO THE CORE PLATFORM, ACM @ UIUC'S MAXIMUM LIABILITY WILL
                BE LIMITED TO THE AMOUNT YOU ACTUALLY PAID TO ACM @ UIUC FOR SUCH SERVICES.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={2} mb="md">
                10. Indemnification
              </Title>
              <Text>
                You agree to indemnify, defend, and hold harmless ACM @ UIUC, its officers,
                directors, employees, volunteers, and agents from and against all claims,
                liabilities, damages, losses, costs, expenses, and fees (including reasonable
                attorneys' fees) that arise from or relate to your use of the Core Platform or
                violation of these Terms.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={2} mb="md">
                11. General Legal Terms
              </Title>

              <Title order={3} mt="md">
                11.1 Governing Law
              </Title>
              <Text>
                These Terms shall be governed by and construed in accordance with the laws of the
                State of Illinois, without regard to its conflict of law provisions. Any legal
                action or proceeding relating to these Terms shall be brought exclusively in the
                state or federal courts located in Champaign County, Illinois.
              </Text>

              <Title order={3} mt="md">
                11.2 Amendments
              </Title>
              <Text>
                ACM @ UIUC may amend these Terms at any time by posting the amended terms on the ACM
                @ UIUC website or by providing notice to you. Your continued use of the Core
                Platform after such posting or notification constitutes your acceptance of the
                amended terms.
              </Text>

              <Title order={3} mt="md">
                11.3 Assignment
              </Title>
              <Text>
                You may not assign these Terms or any of your rights or obligations hereunder
                without ACM @ UIUC's prior written consent. ACM @ UIUC may assign these Terms
                without your consent.
              </Text>

              <Title order={3} mt="md">
                11.4 Relationship to Open Source License
              </Title>
              <Text>
                These Terms govern your use of the Core Platform service. Your use of the ACM @ UIUC
                Core Platform source code is governed by the BSD 3-Clause License. In the event of a
                conflict between these Terms and the BSD 3-Clause License with respect to the source
                code, the BSD 3-Clause License shall prevail.
              </Text>

              <Title order={3} mt="md">
                11.5 Entire Agreement
              </Title>
              <Text>
                These Terms constitute the entire agreement between you and ACM @ UIUC regarding the
                Core Platform and supersede all prior and contemporaneous agreements, proposals, or
                representations, written or oral, concerning the subject matter of these Terms.
              </Text>

              <Title order={3} mt="md">
                11.6 Severability
              </Title>
              <Text>
                If any provision of these Terms is held to be invalid or unenforceable, such
                provision shall be struck and the remaining provisions shall be enforced to the
                fullest extent under law.
              </Text>

              <Title order={3} mt="md">
                11.7 Waiver
              </Title>
              <Text>
                The failure of ACM @ UIUC to enforce any right or provision of these Terms will not
                be deemed a waiver of such right or provision.
              </Text>

              <Title order={3} mt="md">
                11.8 Contributions
              </Title>
              <Text>
                If you contribute to the ACM @ UIUC Core Platform source code, your contributions
                will be licensed under the same BSD 3-Clause License that covers the project. You
                represent that you have the legal right to provide any contributions you make.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={2} mb="md">
                12. Changes to Terms
              </Title>
              <Text>
                ACM @ UIUC may modify these Terms at any time by posting the modified terms on our
                website. We will make reasonable efforts to notify you of material changes through
                the ACM @ UIUC website or other appropriate communication channels. Your continued
                use of the Core Platform after such posting or notification constitutes your
                acceptance of the modified terms.
              </Text>
              <Text mt="md">
                If you do not agree to the modified Terms, you must stop using the Core Platform.
                Changes will not apply retroactively and will become effective no sooner than 30
                days after they are posted, except for changes addressing new functions or changes
                made for legal reasons, which will be effective immediately.
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={2} mb="md">
                13. Contact Information
              </Title>
              <Text>If you have any questions about these Terms, please contact:</Text>
              <Box mt="md">
                <Text>ACM @ UIUC</Text>
                <Text>201 N Goodwin Avenue, Room 1104</Text>
                <Text>Urbana, IL 61801</Text>
                <Text>
                  Email:{' '}
                  <Anchor href="mailto:officers@acm.illinois.edu">officers@acm.illinois.edu</Anchor>
                </Text>
                <Text>
                  Website: <Anchor href="https://www.acm.illinois.edu">acm.illinois.edu</Anchor>
                </Text>
              </Box>
              <Text mt="xl" fw={500}>
                By using the ACM @ UIUC Core Platform, you acknowledge that you have read these
                Terms, understand them, and agree to be bound by them.
              </Text>
            </Paper>
          </Stack>
        </Container>
      </AcmAppShell>
    </>
  );
};

export default TermsOfService;
